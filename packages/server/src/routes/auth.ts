import { Router } from 'express';
import { randomBytes } from 'crypto';
import type { AuthResponse, LogoutResponse } from '@twnr/shared';
import type { RouteDeps, Middleware } from './middleware.js';
import { asyncHandler, HttpError } from './async-handler.js';
import { universeConfig } from '../universe-config.js';
import {
    bumpUserTokenVersion,
    createGuestUser,
    createUser,
    getUserByEmail,
} from '../db/queries/user.js';
import { insertPlayer, setPlayerShipId, markSectorVisited } from '../db/queries/player.js';
import { getSectorDbId } from '../db/queries/sector.js';
import { getStartingShipTypeByName, insertStartingShip } from '../db/queries/ship.js';
import { getFirstUniverseId, getUniverseEditDefaults } from '../db/queries/universe.js';
import { bootstrapUniverse } from '../services/universe-bootstrap.js';

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
                ADMIN_API_KEY && req.headers['x-admin-key'] === ADMIN_API_KEY ? 'admin' : 'player';

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

    // ─── Guest (demo) ──────────────────────────────────────────────────
    //
    // One-click demo path: creates an `is_guest=true` user, ensures a universe
    // exists (auto-bootstraps one with defaults if not), inserts a player +
    // starting ship, and returns a token + universeId so the client can
    // connect to the WS without going through universe-select.
    // Guest users are deleted on disconnect (see server.ts close handler).

    router.post(
        '/api/auth/guest',
        registerLimiter,
        asyncHandler(async (_req, res) => {
            const suffix = randomBytes(4).toString('hex');
            const guestName = `Guest_${suffix}`;
            const guestEmail = `guest-${suffix}@guest.local`;
            const guestPassword = randomBytes(16).toString('hex');
            const passwordHash = hashPassword(guestPassword);

            let user;
            try {
                user = await createGuestUser(guestEmail, passwordHash);
            } catch (err) {
                if ((err as { code?: string }).code === '23505') {
                    throw new HttpError(409, 'Guest creation collided — try again');
                }
                throw err;
            }

            // Ensure a universe exists.
            let universeId = await getFirstUniverseId();
            if (universeId === null) {
                universeId = await bootstrapUniverse('Demo Universe');
            }

            // Universe-specific starting parameters fall back to global defaults.
            const editDefaults = await getUniverseEditDefaults(universeId);
            const startSector = universeConfig.startingSector;
            const startingTurns = editDefaults?.starting_turns ?? universeConfig.startingTurns;
            const startingCredits =
                editDefaults?.starting_credits ?? universeConfig.startingCredits;
            const startingShip = editDefaults?.starting_ship ?? universeConfig.startingShip;
            const startingDrones = editDefaults?.starting_drones ?? universeConfig.startingDrones;

            const startSectorId = await getSectorDbId(startSector, universeId);
            if (startSectorId === undefined) {
                throw new HttpError(500, 'Starting sector not found');
            }

            const playerId = await insertPlayer(
                guestName,
                user.id,
                universeId,
                startSectorId,
                startingCredits,
                startingTurns,
            );

            const startShipType = await getStartingShipTypeByName(startingShip);
            if (startShipType) {
                const newShipId = await insertStartingShip(
                    playerId,
                    startShipType.id,
                    startSectorId,
                    startingDrones,
                    universeConfig.startingShields,
                    startShipType.starting_holds,
                    startShipType.turns_per_warp,
                );
                await setPlayerShipId(playerId, newShipId);
            }

            await markSectorVisited(playerId, startSectorId);

            const token = signPlayerToken({
                userId: user.id,
                name: guestName,
                role: user.role,
                tokenVersion: user.token_version,
            });
            setAuthCookie(res, token);

            const body: AuthResponse & { universeId: number; isGuest: true } = {
                userId: user.id,
                name: guestName,
                role: user.role,
                token,
                universeId,
                isGuest: true,
            };
            res.status(201).json(body);
        }),
    );

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

            // Site auth is independent of per-universe online state.
            // Destroyed-ship cooldown is enforced at WebSocket connect time
            // for the specific universe the user tries to enter — see
            // `tryRespawnPlayer` in services/respawn.ts.

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
