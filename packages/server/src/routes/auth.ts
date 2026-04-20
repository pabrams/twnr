import { Router } from 'express';
import type { AuthResponse, LogoutResponse } from '@twnr/shared';
import type { RouteDeps, Middleware } from './middleware.js';
import { asyncHandler, HttpError } from './async-handler.js';
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
        ADMIN_API_KEY,
    } = deps;
    const { authenticateToken, loginLimiter, registerLimiter } = middleware;

    // ─── Logout ────────────────────────────────────────────────────────

    router.post(
        '/api/auth/logout',
        authenticateToken,
        asyncHandler(async (req, res) => {
            const { userId } = getAuthenticatedPlayer(req);
            await bumpUserTokenVersion(userId);
            res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
            const body: LogoutResponse = { success: true };
            res.json(body);
        }),
    );

    // ─── Register ──────────────────────────────────────────────────────

    router.post(
        '/api/auth/register',
        registerLimiter,
        asyncHandler(async (req, res) => {
            const { name, email, password } = req.body;
            if (!name || !email || !password) {
                throw new HttpError(400, 'name, email and password are required');
            }

            const hash = hashPassword(password);
            const role =
                ADMIN_API_KEY && req.headers['x-admin-key'] === ADMIN_API_KEY
                    ? 'admin'
                    : 'player';

            let user;
            try {
                user = await createUser(email, hash, role);
            } catch (err) {
                if ((err as { code?: string }).code === '23505') {
                    throw new HttpError(409, 'Email already registered');
                }
                throw err;
            }

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
        }),
    );

    // ─── Login ─────────────────────────────────────────────────────────

    router.post(
        '/api/auth/login',
        loginLimiter,
        asyncHandler(async (req, res) => {
            const { email, password } = req.body;
            if (!email || !password) {
                throw new HttpError(400, 'email and password are required');
            }

            const user = await getUserByEmail(email);
            if (!user || !verifyPassword(password, user.password_hash)) {
                throw new HttpError(401, 'Invalid credentials');
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
                        throw new HttpError(
                            403,
                            `Your ship was destroyed. You can login in ${remaining} seconds.`,
                        );
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
        }),
    );
}
