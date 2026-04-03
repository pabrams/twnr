import { Router, Request, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { pool } from './db.js';
import { generateUniverse } from './bigbang.js';
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

    // ─── Admin Universe Lifecycle ──────────────────────────────────────

    router.post(
        '/api/admin/universes/generate',
        authenticateAdmin,
        async (req, res): Promise<any> => {
            const { name, sectors, seed, portDensity, twoWayPct } = req.body;

            if (!name || !String(name).trim()) {
                return res.status(400).json({ error: 'name is required' });
            }
            const sectorCount = parseInt(sectors, 10);
            if (!sectors || isNaN(sectorCount) || sectorCount < 20 || sectorCount > 500) {
                return res
                    .status(400)
                    .json({ error: 'sectors is required and must be between 20 and 500' });
            }

            try {
                const result = generateUniverse({
                    sectors: sectorCount,
                    seed: seed != null ? Math.floor(Number(seed)) : undefined,
                    portDensity: portDensity != null ? Number(portDensity) : undefined,
                    twoWayPct: twoWayPct != null ? Number(twoWayPct) : undefined,
                });

                const client = await pool.connect();
                try {
                    await client.query('BEGIN');

                    // Create universe row
                    const univRes = await client.query(
                        'INSERT INTO universes (name, seed) VALUES ($1, $2) RETURNING id',
                        [name, result.seed],
                    );
                    const universeId = univRes.rows[0].id;

                    // Insert sectors
                    for (const s of result.sectors) {
                        await client.query(
                            'INSERT INTO sectors (id, universe_id, name) VALUES ($1, $2, $3)',
                            [s.id, universeId, s.name],
                        );
                    }

                    // Insert warps
                    for (const w of result.warps) {
                        await client.query(
                            'INSERT INTO warps (sector_from, sector_to, universe_id) VALUES ($1, $2, $3)',
                            [w.from, w.to, universeId],
                        );
                    }

                    // Insert trading ports
                    for (const p of result.ports) {
                        await client.query(
                            `INSERT INTO ports (sector_id, universe_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                            [
                                p.sector,
                                universeId,
                                p.class,
                                p.fuel_qty,
                                p.fuel_price,
                                p.org_qty,
                                p.org_price,
                                p.equ_qty,
                                p.equ_price,
                            ],
                        );
                    }

                    // Seed Class 0 port in Sector 1
                    await client.query(
                        `INSERT INTO ports (sector_id, universe_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price)
                         VALUES (1, $1, 0, 0, 0, 0, 0, 0, 0)
                         ON CONFLICT (sector_id, universe_id) DO UPDATE
                         SET class = 0, fuel = 0, fuel_price = 0, organics = 0, org_price = 0, equipment = 0, equ_price = 0`,
                        [universeId],
                    );

                    // Seed Class 9 port at Stardock
                    await client.query(
                        `INSERT INTO ports (sector_id, universe_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price)
                         SELECT id, $1, 9, 0, 0, 0, 0, 0, 0
                         FROM sectors WHERE name = 'Stardock' AND universe_id = $1
                         ON CONFLICT (sector_id, universe_id) DO UPDATE
                         SET class = 9, fuel = 0, fuel_price = 0, organics = 0, org_price = 0, equipment = 0, equ_price = 0`,
                        [universeId],
                    );

                    await client.query('COMMIT');

                    // Count actual data
                    const warpCountRes = await pool.query(
                        'SELECT COUNT(*) FROM warps WHERE universe_id = $1',
                        [universeId],
                    );
                    const portCountRes = await pool.query(
                        'SELECT COUNT(*) FROM ports WHERE universe_id = $1',
                        [universeId],
                    );

                    res.status(201).json({
                        id: universeId,
                        name,
                        seed: result.seed,
                        sectorCount: result.sectors.length,
                        warpCount: parseInt(warpCountRes.rows[0].count, 10),
                        portCount: parseInt(portCountRes.rows[0].count, 10),
                    });
                } catch (err) {
                    await client.query('ROLLBACK');
                    throw err;
                } finally {
                    client.release();
                }
            } catch (err) {
                console.error('Generate universe error', err);
                res.status(500).json({ error: 'Internal server error' });
            }
        },
    );

    router.get(
        '/api/admin/universes/:id/stats',
        authenticateAdmin,
        async (req, res): Promise<any> => {
            const universeId = parseInt(req.params.id as string, 10);

            try {
                const univRes = await pool.query(
                    'SELECT id, name, seed, created_at FROM universes WHERE id = $1',
                    [universeId],
                );
                if (univRes.rows.length === 0) {
                    return res.status(404).json({ error: 'Universe not found' });
                }

                const univ = univRes.rows[0];
                const sectorCount = await pool.query(
                    'SELECT COUNT(*) FROM sectors WHERE universe_id = $1',
                    [universeId],
                );
                const warpCount = await pool.query(
                    'SELECT COUNT(*) FROM warps WHERE universe_id = $1',
                    [universeId],
                );
                const portCount = await pool.query(
                    'SELECT COUNT(*) FROM ports WHERE universe_id = $1',
                    [universeId],
                );
                const playerCount = await pool.query(
                    'SELECT COUNT(*) FROM players WHERE universe_id = $1',
                    [universeId],
                );

                res.json({
                    id: univ.id,
                    name: univ.name,
                    seed: univ.seed,
                    createdAt: univ.created_at,
                    sectorCount: parseInt(sectorCount.rows[0].count, 10),
                    warpCount: parseInt(warpCount.rows[0].count, 10),
                    portCount: parseInt(portCount.rows[0].count, 10),
                    playerCount: parseInt(playerCount.rows[0].count, 10),
                });
            } catch (err) {
                console.error('Universe stats error', err);
                res.status(500).json({ error: 'Internal server error' });
            }
        },
    );

    router.delete('/api/admin/universes/:id', authenticateAdmin, async (req, res): Promise<any> => {
        const universeId = parseInt(req.params.id as string, 10);

        try {
            // Check universe exists
            const univRes = await pool.query('SELECT id FROM universes WHERE id = $1', [
                universeId,
            ]);
            if (univRes.rows.length === 0) {
                return res.status(404).json({ error: 'Universe not found' });
            }

            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // Get player IDs for this universe
                const playerRes = await client.query(
                    'SELECT id FROM players WHERE universe_id = $1',
                    [universeId],
                );
                const playerIds = playerRes.rows.map((r: { id: number }) => r.id);

                if (playerIds.length > 0) {
                    // Delete player-related data
                    await client.query(
                        'DELETE FROM visited_sectors WHERE player_id = ANY($1::int[])',
                        [playerIds],
                    );
                    await client.query('DELETE FROM ship_cargo WHERE player_id = ANY($1::int[])', [
                        playerIds,
                    ]);
                    await client.query(
                        'DELETE FROM player_ships WHERE player_id = ANY($1::int[])',
                        [playerIds],
                    );
                    await client.query('DELETE FROM players WHERE universe_id = $1', [universeId]);
                }

                // Delete universe data
                await client.query('DELETE FROM ports WHERE universe_id = $1', [universeId]);
                await client.query('DELETE FROM warps WHERE universe_id = $1', [universeId]);
                await client.query('DELETE FROM sectors WHERE universe_id = $1', [universeId]);
                await client.query('DELETE FROM universes WHERE id = $1', [universeId]);

                await client.query('COMMIT');

                res.json({ deleted: true, id: universeId });
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
        } catch (err) {
            console.error('Delete universe error', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.put('/api/admin/universes/:id', authenticateAdmin, async (req, res): Promise<any> => {
        const universeId = parseInt(req.params.id as string, 10);
        const { name } = req.body;

        if (!name || !String(name).trim()) {
            return res.status(400).json({ error: 'name is required' });
        }

        try {
            const result = await pool.query(
                'UPDATE universes SET name = $1 WHERE id = $2 RETURNING id, name',
                [name, universeId],
            );
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Universe not found' });
            }

            res.json({ id: result.rows[0].id, name: result.rows[0].name });
        } catch (err) {
            console.error('Rename universe error', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.post(
        '/api/admin/universes/:id/clone',
        authenticateAdmin,
        async (req, res): Promise<any> => {
            const sourceId = parseInt(req.params.id as string, 10);
            const { name } = req.body;

            if (!name || !String(name).trim()) {
                return res.status(400).json({ error: 'name is required' });
            }

            try {
                // Check source exists
                const srcRes = await pool.query('SELECT id, seed FROM universes WHERE id = $1', [
                    sourceId,
                ]);
                if (srcRes.rows.length === 0) {
                    return res.status(404).json({ error: 'Universe not found' });
                }

                const client = await pool.connect();
                try {
                    await client.query('BEGIN');

                    // Create new universe row
                    const newUnivRes = await client.query(
                        'INSERT INTO universes (name, seed) VALUES ($1, $2) RETURNING id',
                        [name, srcRes.rows[0].seed],
                    );
                    const newId = newUnivRes.rows[0].id;

                    // Copy sectors
                    await client.query(
                        `INSERT INTO sectors (id, universe_id, name)
                         SELECT id, $1, name FROM sectors WHERE universe_id = $2`,
                        [newId, sourceId],
                    );

                    // Copy warps
                    await client.query(
                        `INSERT INTO warps (sector_from, sector_to, universe_id)
                         SELECT sector_from, sector_to, $1 FROM warps WHERE universe_id = $2`,
                        [newId, sourceId],
                    );

                    // Copy ports
                    await client.query(
                        `INSERT INTO ports (sector_id, universe_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price)
                         SELECT sector_id, $1, class, fuel, fuel_price, organics, org_price, equipment, equ_price
                         FROM ports WHERE universe_id = $2`,
                        [newId, sourceId],
                    );

                    await client.query('COMMIT');

                    // Get counts
                    const sectorCount = await pool.query(
                        'SELECT COUNT(*) FROM sectors WHERE universe_id = $1',
                        [newId],
                    );
                    const warpCount = await pool.query(
                        'SELECT COUNT(*) FROM warps WHERE universe_id = $1',
                        [newId],
                    );
                    const portCount = await pool.query(
                        'SELECT COUNT(*) FROM ports WHERE universe_id = $1',
                        [newId],
                    );

                    res.status(201).json({
                        id: newId,
                        name,
                        seed: srcRes.rows[0].seed,
                        sectorCount: parseInt(sectorCount.rows[0].count, 10),
                        warpCount: parseInt(warpCount.rows[0].count, 10),
                        portCount: parseInt(portCount.rows[0].count, 10),
                    });
                } catch (err) {
                    await client.query('ROLLBACK');
                    throw err;
                } finally {
                    client.release();
                }
            } catch (err) {
                console.error('Clone universe error', err);
                res.status(500).json({ error: 'Internal server error' });
            }
        },
    );

    router.get(
        '/api/admin/universes/:id/topology',
        authenticateAdmin,
        async (req, res): Promise<any> => {
            const universeId = parseInt(req.params.id as string, 10);

            try {
                const univRes = await pool.query('SELECT id FROM universes WHERE id = $1', [
                    universeId,
                ]);
                if (univRes.rows.length === 0) {
                    return res.status(404).json({ error: 'Universe not found' });
                }

                const sectorRes = await pool.query(
                    'SELECT COUNT(*) FROM sectors WHERE universe_id = $1',
                    [universeId],
                );
                const totalSectors = parseInt(sectorRes.rows[0].count, 10);

                const warpRes = await pool.query(
                    'SELECT sector_from, sector_to FROM warps WHERE universe_id = $1',
                    [universeId],
                );
                const totalWarps = warpRes.rows.length;

                // Count bidirectional pairs (each pair counted once)
                const warpSet = new Set(
                    warpRes.rows.map(
                        (w: { sector_from: number; sector_to: number }) =>
                            `${w.sector_from},${w.sector_to}`,
                    ),
                );
                const counted = new Set<string>();
                let bidirectionalPairs = 0;
                for (const w of warpRes.rows) {
                    const a = Math.min(w.sector_from, w.sector_to);
                    const b = Math.max(w.sector_from, w.sector_to);
                    const key = `${a},${b}`;
                    if (!counted.has(key) && warpSet.has(`${w.sector_to},${w.sector_from}`)) {
                        bidirectionalPairs++;
                        counted.add(key);
                    }
                }

                // Compute out-degree per sector
                const outDeg = new Map<number, number>();
                for (const w of warpRes.rows) {
                    outDeg.set(w.sector_from, (outDeg.get(w.sector_from) || 0) + 1);
                }
                const avgOut =
                    totalSectors > 0 ? Math.round((totalWarps / totalSectors) * 100) / 100 : 0;

                // Dead-end sectors: exactly 1 outgoing warp
                const deadEndSectors: number[] = [];
                for (const [sector, deg] of outDeg) {
                    if (deg === 1) deadEndSectors.push(sector);
                }
                deadEndSectors.sort((a, b) => a - b);

                // BFS connectivity from sector 1
                const adj = new Map<number, number[]>();
                for (const w of warpRes.rows) {
                    if (!adj.has(w.sector_from)) adj.set(w.sector_from, []);
                    adj.get(w.sector_from)!.push(w.sector_to);
                }
                const visited = new Set<number>();
                const queue = [1];
                visited.add(1);
                while (queue.length > 0) {
                    const node = queue.shift()!;
                    for (const next of adj.get(node) || []) {
                        if (!visited.has(next)) {
                            visited.add(next);
                            queue.push(next);
                        }
                    }
                }
                const isConnected = visited.size === totalSectors;

                res.json({
                    totalSectors,
                    totalWarps,
                    bidirectionalPairs,
                    averageOutDegree: avgOut,
                    deadEndSectors,
                    isConnected,
                });
            } catch (err) {
                console.error('Topology error', err);
                res.status(500).json({ error: 'Internal server error' });
            }
        },
    );

    // ─── Port Management ───────────────────────────────────────────────

    const PORT_CLASS_ACTIONS: Record<number, [string, string, string]> = {
        1: ['B', 'B', 'S'],
        2: ['B', 'S', 'B'],
        3: ['S', 'B', 'B'],
        4: ['S', 'S', 'B'],
        5: ['B', 'S', 'S'],
        6: ['S', 'B', 'S'],
        7: ['S', 'S', 'S'],
        8: ['B', 'B', 'B'],
    };

    function validatePortPrices(
        portClass: number,
        fuelPrice: number,
        orgPrice: number,
        equPrice: number,
    ): string | null {
        const actions = PORT_CLASS_ACTIONS[portClass];
        if (!actions) return null;

        const commodities = [
            { name: 'fuel', action: actions[0], price: fuelPrice },
            { name: 'organics', action: actions[1], price: orgPrice },
            { name: 'equipment', action: actions[2], price: equPrice },
        ];

        for (const c of commodities) {
            if (c.action === 'S' && (c.price < 10 || c.price > 50)) {
                return `${c.name} is a selling commodity for class ${portClass} and price must be 10-50, got ${c.price}`;
            }
            if (c.action === 'B' && (c.price < 51 || c.price > 100)) {
                return `${c.name} is a buying commodity for class ${portClass} and price must be 51-100, got ${c.price}`;
            }
        }
        return null;
    }

    router.get(
        '/api/admin/universes/:id/ports',
        authenticateAdmin,
        async (req, res): Promise<any> => {
            const universeId = parseInt(req.params.id as string, 10);

            try {
                const univRes = await pool.query('SELECT id FROM universes WHERE id = $1', [
                    universeId,
                ]);
                if (univRes.rows.length === 0) {
                    return res.status(404).json({ error: 'Universe not found' });
                }

                const portRes = await pool.query(
                    `SELECT sector_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price
                     FROM ports WHERE universe_id = $1 ORDER BY sector_id ASC`,
                    [universeId],
                );

                const ports = portRes.rows.map((r: any) => ({
                    sectorId: r.sector_id,
                    class: r.class,
                    fuel: r.fuel,
                    fuelPrice: r.fuel_price,
                    organics: r.organics,
                    orgPrice: r.org_price,
                    equipment: r.equipment,
                    equPrice: r.equ_price,
                }));

                res.json(ports);
            } catch (err) {
                console.error('List ports error', err);
                res.status(500).json({ error: 'Internal server error' });
            }
        },
    );

    router.put(
        '/api/admin/universes/:id/ports/:sectorId',
        authenticateAdmin,
        async (req, res): Promise<any> => {
            const universeId = parseInt(req.params.id as string, 10);
            const sectorId = parseInt(req.params.sectorId as string, 10);

            try {
                // Check universe exists
                const univRes = await pool.query('SELECT id FROM universes WHERE id = $1', [
                    universeId,
                ]);
                if (univRes.rows.length === 0) {
                    return res.status(404).json({ error: 'Universe not found' });
                }

                // Check port exists
                const portRes = await pool.query(
                    'SELECT * FROM ports WHERE sector_id = $1 AND universe_id = $2',
                    [sectorId, universeId],
                );
                if (portRes.rows.length === 0) {
                    return res.status(404).json({ error: 'Port not found' });
                }

                const existing = portRes.rows[0];

                // Reject special ports
                if (existing.class === 0 || existing.class === 9) {
                    return res.status(403).json({ error: 'Cannot modify special port' });
                }

                // Merge updates with existing values
                const newClass =
                    req.body.class !== undefined ? parseInt(req.body.class, 10) : existing.class;
                const newFuel =
                    req.body.fuel !== undefined ? parseInt(req.body.fuel, 10) : existing.fuel;
                const newFuelPrice =
                    req.body.fuelPrice !== undefined
                        ? parseInt(req.body.fuelPrice, 10)
                        : existing.fuel_price;
                const newOrganics =
                    req.body.organics !== undefined
                        ? parseInt(req.body.organics, 10)
                        : existing.organics;
                const newOrgPrice =
                    req.body.orgPrice !== undefined
                        ? parseInt(req.body.orgPrice, 10)
                        : existing.org_price;
                const newEquipment =
                    req.body.equipment !== undefined
                        ? parseInt(req.body.equipment, 10)
                        : existing.equipment;
                const newEquPrice =
                    req.body.equPrice !== undefined
                        ? parseInt(req.body.equPrice, 10)
                        : existing.equ_price;

                // Validate class
                if (newClass < 1 || newClass > 8) {
                    return res.status(400).json({ error: 'class must be 1-8' });
                }

                // Validate quantities
                for (const [name, val] of [
                    ['fuel', newFuel],
                    ['organics', newOrganics],
                    ['equipment', newEquipment],
                ] as const) {
                    if (val < 0 || val > 5000) {
                        return res.status(400).json({ error: `${name} must be 0-5000` });
                    }
                }

                // Validate prices against class
                const priceError = validatePortPrices(
                    newClass,
                    newFuelPrice,
                    newOrgPrice,
                    newEquPrice,
                );
                if (priceError) {
                    return res.status(400).json({ error: priceError });
                }

                await pool.query(
                    `UPDATE ports SET class = $1, fuel = $2, fuel_price = $3, organics = $4, org_price = $5, equipment = $6, equ_price = $7
                     WHERE sector_id = $8 AND universe_id = $9`,
                    [
                        newClass,
                        newFuel,
                        newFuelPrice,
                        newOrganics,
                        newOrgPrice,
                        newEquipment,
                        newEquPrice,
                        sectorId,
                        universeId,
                    ],
                );

                res.json({
                    sectorId,
                    class: newClass,
                    fuel: newFuel,
                    fuelPrice: newFuelPrice,
                    organics: newOrganics,
                    orgPrice: newOrgPrice,
                    equipment: newEquipment,
                    equPrice: newEquPrice,
                });
            } catch (err) {
                console.error('Update port error', err);
                res.status(500).json({ error: 'Internal server error' });
            }
        },
    );

    router.post(
        '/api/admin/universes/:id/ports/:sectorId',
        authenticateAdmin,
        async (req, res): Promise<any> => {
            const universeId = parseInt(req.params.id as string, 10);
            const sectorId = parseInt(req.params.sectorId as string, 10);

            try {
                // Check universe exists
                const univRes = await pool.query('SELECT id FROM universes WHERE id = $1', [
                    universeId,
                ]);
                if (univRes.rows.length === 0) {
                    return res.status(404).json({ error: 'Universe not found' });
                }

                // Check sector exists
                const sectorRes = await pool.query(
                    'SELECT id FROM sectors WHERE id = $1 AND universe_id = $2',
                    [sectorId, universeId],
                );
                if (sectorRes.rows.length === 0) {
                    return res.status(404).json({ error: 'Sector not found' });
                }

                // Check no existing port
                const existingPort = await pool.query(
                    'SELECT id FROM ports WHERE sector_id = $1 AND universe_id = $2',
                    [sectorId, universeId],
                );
                if (existingPort.rows.length > 0) {
                    return res.status(409).json({ error: 'Port already exists' });
                }

                const {
                    class: portClass,
                    fuel,
                    fuelPrice,
                    organics,
                    orgPrice,
                    equipment,
                    equPrice,
                } = req.body;

                // Validate class
                const cls = parseInt(portClass, 10);
                if (isNaN(cls) || cls < 1 || cls > 8) {
                    return res.status(400).json({ error: 'class must be 1-8 for trading ports' });
                }

                // Validate quantities
                const fuelQty = parseInt(fuel, 10);
                const orgQty = parseInt(organics, 10);
                const equQty = parseInt(equipment, 10);
                for (const [name, val] of [
                    ['fuel', fuelQty],
                    ['organics', orgQty],
                    ['equipment', equQty],
                ] as const) {
                    if (isNaN(val) || val < 0 || val > 5000) {
                        return res.status(400).json({ error: `${name} must be 0-5000` });
                    }
                }

                const fp = parseInt(fuelPrice, 10);
                const op = parseInt(orgPrice, 10);
                const ep = parseInt(equPrice, 10);

                if (isNaN(fp) || isNaN(op) || isNaN(ep)) {
                    return res.status(400).json({ error: 'all price fields are required' });
                }

                // Validate prices
                const priceError = validatePortPrices(cls, fp, op, ep);
                if (priceError) {
                    return res.status(400).json({ error: priceError });
                }

                await pool.query(
                    `INSERT INTO ports (sector_id, universe_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                    [sectorId, universeId, cls, fuelQty, fp, orgQty, op, equQty, ep],
                );

                res.status(201).json({
                    sectorId,
                    class: cls,
                    fuel: fuelQty,
                    fuelPrice: fp,
                    organics: orgQty,
                    orgPrice: op,
                    equipment: equQty,
                    equPrice: ep,
                });
            } catch (err) {
                console.error('Create port error', err);
                res.status(500).json({ error: 'Internal server error' });
            }
        },
    );

    router.delete(
        '/api/admin/universes/:id/ports/:sectorId',
        authenticateAdmin,
        async (req, res): Promise<any> => {
            const universeId = parseInt(req.params.id as string, 10);
            const sectorId = parseInt(req.params.sectorId as string, 10);

            try {
                // Check universe exists
                const univRes = await pool.query('SELECT id FROM universes WHERE id = $1', [
                    universeId,
                ]);
                if (univRes.rows.length === 0) {
                    return res.status(404).json({ error: 'Universe not found' });
                }

                // Check port exists
                const portRes = await pool.query(
                    'SELECT class FROM ports WHERE sector_id = $1 AND universe_id = $2',
                    [sectorId, universeId],
                );
                if (portRes.rows.length === 0) {
                    return res.status(404).json({ error: 'Port not found' });
                }

                // Reject special ports
                if (portRes.rows[0].class === 0 || portRes.rows[0].class === 9) {
                    return res.status(403).json({ error: 'Cannot delete special port' });
                }

                await pool.query('DELETE FROM ports WHERE sector_id = $1 AND universe_id = $2', [
                    sectorId,
                    universeId,
                ]);

                res.json({ deleted: true, sectorId });
            } catch (err) {
                console.error('Delete port error', err);
                res.status(500).json({ error: 'Internal server error' });
            }
        },
    );

    return router;
}
