import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { Socket } from 'net';
import helmet from 'helmet';
import { createServer, Server, IncomingMessage } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { connectDB } from './db/index.js';
import { createRoutes } from './routes/index.js';
import * as auth from './auth/index.js';
import { ServerTag } from '@twnr/shared';
import type { AuthTokenPayload, ClientEnvelope, ServerEnvelope } from '@twnr/shared';
import { shipConfigs } from './ship-config.js';
import { players } from './state/players.js';
import { sendEnvelope, sendError, broadcastTo } from './state/messaging.js';
import { routeMessage } from './handlers/message-router.js';
import { clearPendingShipPurchase } from './state/pending-ship-purchases.js';
import { getStartingShipTypeByName } from './db/queries/ship.js';
import { getUniverseEditDefaults } from './db/queries/universe.js';
import { universeConfig } from './universe-config.js';
import { getUserTokenVersion, markUserConnected, isGuestUser } from './db/queries/user.js';
import {
    getPlayerConnectInfo,
    markPlayerLoggedIn,
    markPlayerLoggedOut,
    markSectorVisited,
    getOnPlanetId,
    logPlayerCommand,
} from './db/queries/player.js';
import { countSectorsInUniverse, getStarbaseSectorNumber } from './db/queries/sector.js';
import { tryRespawnPlayer } from './services/respawn.js';
import { startHourlyScheduler } from './services/hourly-jobs.js';

const app: ReturnType<typeof express> = express();
app.set('trust proxy', 1);
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                ...helmet.contentSecurityPolicy.getDefaultDirectives(),
                'upgrade-insecure-requests': null,
            },
        },
        strictTransportSecurity: false,
    }),
);
app.use(express.json());
const server: Server = createServer(app);
const wss = new WebSocketServer({ server });

// Heartbeat: ping every 30s; sockets that don't pong by the next tick get
// terminated, which fires the close handler. Without this, hard disconnects
// (yanked ethernet, killed wifi) wouldn't surface until TCP keepalive kicks
// in (~2 hours on Linux defaults), during which the docked-while-online
// visibility predicate would keep them hidden in their sector.
const aliveSockets = new WeakSet<WebSocket>();
const HEARTBEAT_INTERVAL_MS = 30_000;
const heartbeatInterval = setInterval(() => {
    for (const ws of wss.clients) {
        if (!aliveSockets.has(ws)) {
            ws.terminate();
            continue;
        }
        aliveSockets.delete(ws);
        ws.ping();
    }
}, HEARTBEAT_INTERVAL_MS);
wss.on('close', () => clearInterval(heartbeatInterval));

server.prependListener('upgrade', (req: IncomingMessage, socket: Socket) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    if (url.pathname !== '/ws') {
        auth.rejectWebSocketUpgrade(socket);
        return;
    }
    if (!auth.isAllowedWebSocketOrigin(req)) {
        auth.rejectWebSocketUpgrade(socket);
        return;
    }
    const cookies = auth.parseCookies(req.headers.cookie);
    const jwtToken = cookies[auth.AUTH_COOKIE_NAME];
    if (!jwtToken) {
        auth.rejectWebSocketUpgrade(socket);
        return;
    }
    try {
        auth.verifyToken(jwtToken);

        const universeParam = url.searchParams.get('universe');
        if (!universeParam) {
            auth.rejectWebSocketUpgrade(socket);
            return;
        }
    } catch {
        auth.rejectWebSocketUpgrade(socket);
    }
});

app.use(
    createRoutes({
        hashPassword: auth.hashPassword,
        verifyPassword: auth.verifyPassword,
        signPlayerToken: auth.signPlayerToken,
        verifyToken: auth.verifyToken,
        setAuthCookie: auth.setAuthCookie,
        getJwtToken: auth.getJwtToken,
        getAuthenticatedPlayer: auth.getAuthenticatedPlayer,
        shipConfigs,
        players,
        AUTH_COOKIE_NAME: auth.AUTH_COOKIE_NAME,
        ADMIN_API_KEY: auth.ADMIN_API_KEY,
    }),
);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get(/.*/, (req, res, next) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/ws')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
});

wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    aliveSockets.add(ws);
    ws.on('pong', () => aliveSockets.add(ws));

    const cookies = auth.parseCookies(req.headers.cookie);
    let authPayload: AuthTokenPayload;
    try {
        authPayload = auth.verifyToken(cookies[auth.AUTH_COOKIE_NAME] || '');
    } catch {
        ws.close(1008, 'Authentication required');
        return;
    }

    const userId = authPayload.userId;

    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const universeParam = url.searchParams.get('universe');
    if (!universeParam) {
        ws.close(1008, 'Universe parameter required');
        return;
    }
    const universeId = parseInt(universeParam, 10);
    if (isNaN(universeId)) {
        ws.close(1008, 'Invalid universe parameter');
        return;
    }

    try {
        const tokenVersion = await getUserTokenVersion(userId);
        if (tokenVersion === undefined) {
            ws.close(1008, 'User not found');
            return;
        }
        if (tokenVersion !== authPayload.tokenVersion) {
            ws.close(1008, 'Token has been revoked');
            return;
        }

        let playerRow = await getPlayerConnectInfo(userId, universeId);
        if (!playerRow) {
            ws.close(1008, 'No player in this universe');
            return;
        }

        // Per-universe destruction-cooldown gate. Site auth is independent
        // of online status — a destroyed player can stay logged in (and
        // online in other universes), but reconnecting to *this* universe
        // either has to wait out the respawn delay or, if the delay has
        // elapsed, gets a fresh starting ship + sector + credits inline
        // and proceeds with the connect.
        const respawn = await tryRespawnPlayer(playerRow.id);
        if (respawn.kind === 'wait') {
            ws.close(1008, `Ship destroyed; respawn in ${respawn.remainingSeconds}s`);
            return;
        }
        if (respawn.kind === 'respawned') {
            // Reload the row — ship_id/current_sector_id/credits all changed.
            playerRow = await getPlayerConnectInfo(userId, universeId);
            if (!playerRow) {
                ws.close(1008, 'No player in this universe');
                return;
            }
        }

        const playerId = playerRow.id;
        const sectorId: number = playerRow.current_sector_id;
        const sector: number = playerRow.sector_number;

        await markPlayerLoggedIn(playerId);
        await markUserConnected(userId);
        await markSectorVisited(playerId, sectorId);

        const isAdmin = authPayload.role === 'admin';
        players[playerId] = {
            ws,
            sector,
            sectorId,
            shipId: playerRow.ship_id,
            name: playerRow.name,
            universeId,
            docked: false,
            isAdmin,
        };
        const [totalSectors, starbaseSector, guestFlag, onPlanetId] = await Promise.all([
            countSectorsInUniverse(universeId),
            getStarbaseSectorNumber(universeId),
            isGuestUser(userId),
            getOnPlanetId(playerId),
        ]);

        // If the player is shipless, fold the starting-ship type info into
        // the Welcome envelope so the client's connect flow can drive the
        // "name your new ship" prompt directly — no separate ShipNameRequired
        // round trip on connect.
        let startingShipForWelcome:
            | { typeName: string; typeDisplayName: string | null }
            | undefined;
        if (playerRow.ship_id === null) {
            const editDefaults = await getUniverseEditDefaults(universeId);
            const startShipName = editDefaults?.starting_ship ?? universeConfig.startingShip;
            const startShipType = await getStartingShipTypeByName(startShipName);
            if (startShipType) {
                startingShipForWelcome = {
                    typeName: startShipType.name,
                    typeDisplayName: startShipType.display_name,
                };
            }
        }

        const welcomeLocation = onPlanetId !== null ? 'planet' : 'sector';
        const welcomeMsg: ServerEnvelope = {
            type: ServerTag.Welcome,
            playerId,
            name: playerRow.name,
            sector,
            totalSectors,
            shipName: playerRow.ship_name ?? '',
            coloredShipName: playerRow.ship_display_name ?? null,
            ...(startingShipForWelcome ? { startingShip: startingShipForWelcome } : {}),
            starbaseSector,
            location: welcomeLocation,
            isGuest: guestFlag,
            isAdmin,
            clanId: playerRow.clan_id ?? null,
            token: auth.signPlayerToken({
                userId,
                name: playerRow.name,
                role: authPayload.role,
                tokenVersion,
            }),
        };
        await sendEnvelope(playerId, welcomeMsg);

        let tokens = 50;
        const refillInterval = setInterval(() => {
            tokens = Math.min(50, tokens + 20);
        }, 1000);

        ws.on('message', async (message) => {
            if (tokens <= 0) {
                sendEnvelope(playerId, { type: ServerTag.RateLimited });
                return;
            }
            tokens--;

            let data: ClientEnvelope;
            try {
                data = JSON.parse(message.toString()) as ClientEnvelope;
            } catch {
                sendError(playerId, 'Invalid JSON');
                return;
            }

            try {
                await routeMessage(playerId, data);
            } catch (err) {
                console.error('Message handler error:', err);
                sendError(playerId, 'Internal server error');
            }

            logPlayerCommand(playerId, universeId, data.type, data).catch((err) =>
                console.error('Command log error:', err),
            );
        });

        ws.on('close', () => {
            clearInterval(refillInterval);
            clearPendingShipPurchase(playerId);
            const lastSector = players[playerId]?.sector;
            const lastUniverse = players[playerId]?.universeId;
            delete players[playerId];

            (async () => {
                try {
                    await markPlayerLoggedOut(playerId);
                } catch (err) {
                    console.error('Disconnect cleanup error:', err);
                }
            })();

            if (lastSector && lastUniverse) {
                const clientsToNotify = new Set<WebSocket>();
                for (const p of Object.values(players)) {
                    if (p.sector === lastSector && p.universeId === lastUniverse) {
                        clientsToNotify.add(p.ws);
                    }
                }
                broadcastTo({ type: ServerTag.PlayerLeft, playerId }, clientsToNotify);
            }
        });
    } catch (error) {
        console.error('Connection error:', error);
        ws.close();
    }
});

export async function startServer() {
    try {
        await connectDB();
        startHourlyScheduler();

        const port = parseInt(process.env.PORT || '3000', 10);
        server.listen(port, () => {
            console.log(`Server listening on port ${port}`);
        });
    } catch (error) {
        console.error('Error during server startup:', error);
        throw error;
    }
}

// Only start the server if this file is run directly.
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
    startServer();
}

export { app, server, wss };
