import { Router, Request, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { pool } from './db.js';
import type {
    AuthTokenPayload,
    AuthResponse,
    LogoutResponse,
    ServerStatsResponse,
} from '@twnr/shared';

interface RouteDeps {
    hashPassword: (password: string) => string;
    verifyPassword: (password: string, storedHash: string | null) => boolean;
    signPlayerToken: (payload: AuthTokenPayload) => string;
    verifyToken: (token: string) => AuthTokenPayload;
    setAuthCookie: (res: Response, token: string) => void;
    getJwtToken: (req: Request) => string | null;
    getAuthenticatedPlayer: (req: Request) => AuthTokenPayload;
    shipConfigs: Record<string, any>;
    players: Record<number, { ws: any; sector: number; name: string }>;
    AUTH_COOKIE_NAME: string;
    ADMIN_API_KEY: string | undefined;
}

export function createRoutes(deps: RouteDeps): Router {
    const router = Router();

    const {
        hashPassword,
        verifyPassword,
        signPlayerToken,
        verifyToken,
        setAuthCookie,
        getJwtToken,
        getAuthenticatedPlayer,
        shipConfigs,
        players,
        AUTH_COOKIE_NAME,
        ADMIN_API_KEY,
    } = deps;

    async function authenticateToken(
        req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> {
        const jwtToken = getJwtToken(req);
        if (!jwtToken) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }

        let payload: AuthTokenPayload;
        try {
            payload = verifyToken(jwtToken);
        } catch {
            res.status(403).json({ error: 'Invalid token' });
            return;
        }

        try {
            const result = await pool.query('SELECT token_version FROM users WHERE id = $1', [
                payload.userId,
            ]);
            if (result.rows.length === 0 || result.rows[0].token_version !== payload.tokenVersion) {
                res.status(401).json({ error: 'Token has been revoked' });
                return;
            }
        } catch {
            res.status(500).json({ error: 'Internal server error' });
            return;
        }

        (req as any).player = payload;
        next();
    }

    function authenticateAdmin(req: Request, res: Response, next: NextFunction): void {
        if (ADMIN_API_KEY && req.headers['x-admin-key'] === ADMIN_API_KEY) {
            next();
            return;
        }

        const token = getJwtToken(req);
        if (!token) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        try {
            const payload = verifyToken(token);
            if (payload.role !== 'admin') {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }

            (req as any).player = payload;
            next();
        } catch {
            res.status(403).json({ error: 'Forbidden' });
        }
    }

    const loginLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 10,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
    });

    const registerLimiter = rateLimit({
        windowMs: 60 * 60 * 1000,
        limit: 5,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
    });

    // ─── Logout ────────────────────────────────────────────────────────

    router.post('/api/auth/logout', authenticateToken, async (req, res): Promise<any> => {
        const { userId } = getAuthenticatedPlayer(req);
        try {
            await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [
                userId,
            ]);
            res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
            const body: LogoutResponse = { success: true };
            res.json(body);
        } catch (err) {
            console.error('Logout error', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ─── Register ──────────────────────────────────────────────────────

    router.post('/api/auth/register', registerLimiter, async (req, res): Promise<any> => {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'name, email and password are required' });
        }

        const hash = hashPassword(password);
        const role = 'player';

        try {
            const result = await pool.query(
                `INSERT INTO users (email, password_hash, role)
           VALUES ($1, $2, $3) RETURNING id, email, role, token_version`,
                [email, hash, role],
            );
            const user = result.rows[0];

            const token = signPlayerToken({
                userId: user.id,
                name,
                role: user.role,
                tokenVersion: user.token_version,
            });

            setAuthCookie(res, token);
            const body: AuthResponse = {
                userId: user.id,
                name,
                role: user.role,
                token,
            };
            res.status(201).json(body);
        } catch (err: any) {
            if (err.code === '23505') {
                return res.status(409).json({ error: 'Email already registered' });
            }
            console.error('Register error', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ─── Login ─────────────────────────────────────────────────────────

    router.post('/api/auth/login', loginLimiter, async (req, res): Promise<any> => {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'email and password are required' });
        }

        try {
            const result = await pool.query(
                'SELECT id, role, password_hash, token_version FROM users WHERE email = $1',
                [email],
            );
            if (
                result.rows.length === 0 ||
                !verifyPassword(password, result.rows[0].password_hash)
            ) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const user = result.rows[0];

            // Check ship_destroyed_date for any player of this user
            const playersRes = await pool.query(
                'SELECT id, ship_destroyed_date, universe_id FROM players WHERE user_id = $1',
                [user.id],
            );
            for (const player of playersRes.rows) {
                if (player.ship_destroyed_date) {
                    const delaySecs = parseInt(
                        process.env.SHIP_DESTROYED_LOGIN_DELAY_SECONDS || '0',
                        10,
                    );
                    const elapsedSecs =
                        (Date.now() - new Date(player.ship_destroyed_date).getTime()) / 1000;

                    if (elapsedSecs < delaySecs) {
                        const remaining = Math.ceil(delaySecs - elapsedSecs);
                        return res.status(403).json({
                            error: `Your ship was destroyed. You can login in ${remaining} seconds.`,
                        });
                    }

                    // Delay passed — clear destroyed date and give new ship
                    await pool.query(
                        'UPDATE players SET ship_destroyed_date = NULL, current_sector = 1 WHERE id = $1',
                        [player.id],
                    );
                    await pool.query('DELETE FROM player_ships WHERE player_id = $1', [player.id]);
                    await pool.query('DELETE FROM ship_cargo WHERE player_id = $1', [player.id]);
                    const merchant = shipConfigs['Merchant Freighter'];
                    if (merchant) {
                        await pool.query(
                            `INSERT INTO player_ships (player_id, ship_name, fighters, shields, cargo_limit)
                             VALUES ($1, $2, 0, 0, $3)`,
                            [player.id, merchant.name, merchant.startingHolds],
                        );
                    }
                    await pool.query(
                        `INSERT INTO ship_cargo (player_id, fuel, organics, equipment, credits)
                         VALUES ($1, 0, 0, 0, 10000)`,
                        [player.id],
                    );
                }
            }

            const token = signPlayerToken({
                userId: user.id,
                role: user.role,
                tokenVersion: user.token_version,
            });

            setAuthCookie(res, token);
            const body: AuthResponse = {
                userId: user.id,
                role: user.role,
                token,
            };
            res.json(body);
        } catch (err) {
            console.error('Login error', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ─── Universe Management ───────────────────────────────────────────

    router.post('/api/universes', authenticateToken, async (req, res): Promise<any> => {
        const { name } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'name is required' });
        }

        try {
            const result = await pool.query(
                'INSERT INTO universes (name) VALUES ($1) RETURNING id, name',
                [name],
            );
            const universe = result.rows[0];
            res.status(201).json({ universeId: universe.id, name: universe.name });
        } catch (err) {
            console.error('Create universe error', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.get('/api/universes', authenticateToken, async (req, res): Promise<any> => {
        const { userId } = getAuthenticatedPlayer(req);
        try {
            const result = await pool.query(
                `SELECT u.id, u.name, u.created_at, p.id AS player_id, p.name AS player_name
                 FROM universes u
                 LEFT JOIN players p ON p.universe_id = u.id AND p.user_id = $1
                 ORDER BY u.id`,
                [userId],
            );
            const universes = result.rows.map((r) => ({
                id: r.id,
                name: r.name,
                createdAt: r.created_at,
                playerId: r.player_id ?? null,
                playerName: r.player_name ?? null,
            }));
            res.json(universes);
        } catch (err) {
            console.error('List universes error', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.post('/api/universes/:id/join', authenticateToken, async (req, res): Promise<any> => {
        const { userId } = getAuthenticatedPlayer(req);
        const universeId = parseInt(req.params.id as string, 10);
        const { name } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'name is required' });
        }

        try {
            // Check universe exists
            const univRes = await pool.query('SELECT id FROM universes WHERE id = $1', [
                universeId,
            ]);
            if (univRes.rows.length === 0) {
                return res.status(404).json({ error: 'Universe not found' });
            }

            // Create player row
            const playerRes = await pool.query(
                `INSERT INTO players (name, user_id, universe_id, current_sector)
                 VALUES ($1, $2, $3, 1) RETURNING id`,
                [name, userId, universeId],
            );
            const playerId = playerRes.rows[0].id;

            // Create ship
            const merchant = shipConfigs['Merchant Freighter'];
            if (merchant) {
                await pool.query(
                    `INSERT INTO player_ships (player_id, ship_name, fighters, shields, cargo_limit)
                     VALUES ($1, $2, 0, 0, $3)`,
                    [playerId, merchant.name, merchant.startingHolds],
                );
            }

            // Create cargo
            await pool.query(
                `INSERT INTO ship_cargo (player_id, fuel, organics, equipment, credits)
                 VALUES ($1, 0, 0, 0, 10000)`,
                [playerId],
            );

            // Mark starting sector as visited
            await pool.query(
                'INSERT INTO visited_sectors (player_id, sector_id) VALUES ($1, 1) ON CONFLICT DO NOTHING',
                [playerId],
            );

            res.status(201).json({ playerId, universeId });
        } catch (err: any) {
            if (err.code === '23505') {
                return res.status(409).json({ error: 'Already joined this universe' });
            }
            console.error('Join universe error', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ─── Admin ─────────────────────────────────────────────────────────

    router.get('/api/admin/server-stats', authenticateAdmin, async (_req, res): Promise<any> => {
        try {
            const playerCount = await pool.query('SELECT COUNT(*) FROM players');
            const sectorCount = await pool.query('SELECT COUNT(*) FROM sectors');
            const body: ServerStatsResponse = {
                uptime: process.uptime(),
                playersOnline: Object.keys(players).length,
                totalPlayers: parseInt(playerCount.rows[0].count, 10),
                totalSectors: parseInt(sectorCount.rows[0].count, 10),
                nodeVersion: process.version,
                platform: process.platform,
            };
            res.json(body);
        } catch {
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    return router;
}
