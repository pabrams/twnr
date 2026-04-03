import { Router } from 'express';
import { pool } from '../db/index.js';
import type { AuthResponse, LogoutResponse } from '@twnr/shared';
import type { RouteDeps, Middleware } from './middleware.js';
import { newPlayerConfig } from '../game-config.js';

export function createAuthRoutes(router: Router, deps: RouteDeps, middleware: Middleware): void {
    const {
        hashPassword,
        verifyPassword,
        signPlayerToken,
        setAuthCookie,
        getAuthenticatedPlayer,
        shipConfigs,
        AUTH_COOKIE_NAME,
    } = deps;
    const { authenticateToken, loginLimiter, registerLimiter } = middleware;

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
                    const startShip = shipConfigs[newPlayerConfig.startingShip];
                    await pool.query(
                        'UPDATE players SET ship_destroyed_date = NULL, current_sector = $2 WHERE id = $1',
                        [player.id, newPlayerConfig.startingSector],
                    );
                    await pool.query('DELETE FROM player_ships WHERE player_id = $1', [player.id]);
                    await pool.query('DELETE FROM ship_cargo WHERE player_id = $1', [player.id]);
                    if (startShip) {
                        await pool.query(
                            `INSERT INTO player_ships (player_id, ship_name, fighters, shields, cargo_limit)
                             VALUES ($1, $2, $3, $4, $5)`,
                            [
                                player.id,
                                startShip.name,
                                newPlayerConfig.startingFighters,
                                newPlayerConfig.startingShields,
                                startShip.startingHolds,
                            ],
                        );
                    }
                    await pool.query(
                        `INSERT INTO ship_cargo (player_id, fuel, organics, equipment, credits)
                         VALUES ($1, 0, 0, 0, $2)`,
                        [player.id, newPlayerConfig.startingCredits],
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
}
