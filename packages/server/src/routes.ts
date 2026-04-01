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

/**
 * Creates an Express Router with all REST endpoints (auth and admin).
 * @param deps - Shared dependencies from the main server module
 * @returns Configured Express Router
 */
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

    /**
     * Express middleware that authenticates a request via JWT.
     * On success, attaches the player payload to `req.player`. On failure, responds
     * with 401 (no credentials) or 403 (invalid/revoked token). Also checks the
     * token version against the database to detect revocations.
     */
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
            const result = await pool.query('SELECT token_version FROM players WHERE id = $1', [
                payload.playerId,
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

    /**
     * Express middleware that restricts access to admin users. Accepts either an
     * `x-admin-key` header matching the `ADMIN_API_KEY` env var, or a JWT with
     * `role: 'admin'`. Responds with 403 on failure.
     */
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

    /**
     * @route POST /api/auth/logout
     * @description Logs out the player by incrementing their token version (invalidating all
     *              existing JWTs) and clearing the auth cookie.
     * @auth Required
     * @returns {LogoutResponse} 200 - `{ success: true }`
     */
    router.post('/api/auth/logout', authenticateToken, async (req, res): Promise<any> => {
        const { playerId } = getAuthenticatedPlayer(req);
        try {
            await pool.query('UPDATE players SET token_version = token_version + 1 WHERE id = $1', [
                playerId,
            ]);
            res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
            const body: LogoutResponse = { success: true };
            res.json(body);
        } catch (err) {
            console.error('Logout error', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    /**
     * @route POST /api/auth/register
     * @description Registers a new player account. Creates the player, assigns a default
     *              Merchant Freighter ship with 10,000 starting credits, and returns a JWT.
     * @rateLimit 5 requests per hour
     * @body {string} name - Player display name
     * @body {string} email - Player email (must be unique)
     * @body {string} password - Plaintext password (hashed with scrypt before storage)
     * @returns {AuthResponse} 201 - Player info and JWT (also set as HttpOnly cookie)
     * @returns 400 - Missing required fields
     * @returns 409 - Email already registered
     */
    router.post('/api/auth/register', registerLimiter, async (req, res): Promise<any> => {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'name, email and password are required' });
        }

        const hash = hashPassword(password);
        const role = 'player';

        try {
            const result = await pool.query(
                `INSERT INTO players (name, email, password_hash, role, current_sector)
           VALUES ($1, $2, $3, $4, 1) RETURNING id, name, email, role, token_version`,
                [name, email, hash, role],
            );
            const player = result.rows[0];

            await pool.query(
                `INSERT INTO ship_cargo (player_id, fuel, organics, equipment, credits)
           VALUES ($1, 0, 0, 0, 10000) ON CONFLICT (player_id) DO NOTHING`,
                [player.id],
            );
            const merchant = shipConfigs['Merchant Freighter'];
            if (merchant) {
                await pool.query(
                    `INSERT INTO player_ships (player_id, ship_name, fighters, shields, cargo_limit)
             VALUES ($1, $2, 0, 0, $3) ON CONFLICT (player_id) DO NOTHING`,
                    [player.id, merchant.name, merchant.startingHolds],
                );
            }

            const token = signPlayerToken({
                playerId: player.id,
                name: player.name,
                role: player.role,
                tokenVersion: player.token_version,
            });

            setAuthCookie(res, token);
            const body: AuthResponse = {
                playerId: player.id,
                name: player.name,
                role: player.role,
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

    /**
     * @route POST /api/auth/login
     * @description Authenticates a player by email and password. Returns a JWT on success.
     * @rateLimit 10 requests per 15 minutes
     * @body {string} email - Player email
     * @body {string} password - Plaintext password
     * @returns {AuthResponse} 200 - Player info and JWT (also set as HttpOnly cookie)
     * @returns 400 - Missing email or password
     * @returns 401 - Invalid credentials
     */
    router.post('/api/auth/login', loginLimiter, async (req, res): Promise<any> => {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'email and password are required' });
        }

        try {
            const result = await pool.query(
                'SELECT id, name, role, password_hash, token_version, ship_destroyed_date FROM players WHERE email = $1',
                [email],
            );
            if (
                result.rows.length === 0 ||
                !verifyPassword(password, result.rows[0].password_hash)
            ) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const player = result.rows[0];

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

            const token = signPlayerToken({
                playerId: player.id,
                name: player.name,
                role: player.role,
                tokenVersion: player.token_version,
            });

            setAuthCookie(res, token);
            const body: AuthResponse = {
                playerId: player.id,
                name: player.name,
                role: player.role,
                token,
            };
            res.json(body);
        } catch (err) {
            console.error('Login error', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    /**
     * @route GET /api/admin/server-stats
     * @description Returns server statistics including uptime, player counts, and system info.
     * @auth Admin required (admin JWT or `x-admin-key` header)
     * @returns {ServerStatsResponse} 200 - Server statistics
     */
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
