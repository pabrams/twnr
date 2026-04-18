import { Router } from 'express';
import type { AuthResponse, LogoutResponse } from '@twnr/shared';
import type { RouteDeps, Middleware } from './middleware.js';
import { newPlayerConfig } from '../game-config.js';
import { bumpUserTokenVersion, createUser, getUserByEmail } from '../db/queries/user.js';
import {
    listPlayersForUser,
    clearPlayerShip,
    respawnPlayerWithShip,
    respawnPlayerNoShip,
} from '../db/queries/player.js';
import { getSectorDbId } from '../db/queries/sector.js';
import {
    deleteShipByOwner,
    getStartingShipTypeByName,
    insertStartingShip,
} from '../db/queries/ship.js';

export function createAuthRoutes(router: Router, deps: RouteDeps, middleware: Middleware): void {
    const {
        hashPassword,
        verifyPassword,
        signPlayerToken,
        setAuthCookie,
        getAuthenticatedPlayer,
        AUTH_COOKIE_NAME,
    } = deps;
    const { authenticateToken, loginLimiter, registerLimiter } = middleware;

    // ─── Logout ────────────────────────────────────────────────────────

    router.post('/api/auth/logout', authenticateToken, async (req, res) => {
        const { userId } = getAuthenticatedPlayer(req);
        try {
            await bumpUserTokenVersion(userId);
            res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
            const body: LogoutResponse = { success: true };
            res.json(body);
        } catch (err) {
            console.error('Logout error', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ─── Register ──────────────────────────────────────────────────────

    router.post('/api/auth/register', registerLimiter, async (req, res) => {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'name, email and password are required' });
        }

        const hash = hashPassword(password);
        const role = 'player';

        try {
            const user = await createUser(email, hash, role);

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
        } catch (err) {
            if ((err as { code?: string }).code === '23505') {
                return res.status(409).json({ error: 'Email already registered' });
            }
            console.error('Register error', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ─── Login ─────────────────────────────────────────────────────────

    router.post('/api/auth/login', loginLimiter, async (req, res) => {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'email and password are required' });
        }

        try {
            const user = await getUserByEmail(email);
            if (!user || !verifyPassword(password, user.password_hash)) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            // Check ship_destroyed_date for any player of this user
            const userPlayers = await listPlayersForUser(user.id);
            for (const player of userPlayers) {
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
                    const startSectorId = await getSectorDbId(
                        newPlayerConfig.startingSector,
                        player.universe_id,
                    );
                    if (startSectorId === undefined) continue;

                    await clearPlayerShip(player.id);
                    await deleteShipByOwner(player.id);

                    const startShipType = await getStartingShipTypeByName(
                        newPlayerConfig.startingShip,
                    );
                    if (startShipType) {
                        const newShipId = await insertStartingShip(
                            player.id,
                            startShipType.id,
                            startSectorId,
                            newPlayerConfig.startingDrones,
                            newPlayerConfig.startingShields,
                            startShipType.starting_holds,
                            startShipType.turns_per_warp,
                        );
                        await respawnPlayerWithShip(
                            player.id,
                            startSectorId,
                            newShipId,
                            newPlayerConfig.startingCredits,
                        );
                    } else {
                        await respawnPlayerNoShip(player.id, startSectorId);
                    }
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
