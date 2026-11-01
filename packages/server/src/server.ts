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
import { ServerTag, ClientEnvelopeSchema, devServerPort } from '@twnr/shared';
import { worktreeRoot } from './db/pool.js';
import type { AuthTokenPayload, ClientEnvelope, ServerEnvelope } from '@twnr/shared';
import { shipConfigs } from './ship-config.js';
import { onlinePlayers } from './state/players.js';
import { sendEnvelope, sendProtocolError, broadcastTo } from './state/messaging.js';
import { routeMessage } from './handlers/message-router.js';
import { clearPendingShipPurchase } from './state/pending-ship-purchases.js';
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
import { grantStartingShip } from './services/starting-ship.js';
import { startHourlyScheduler } from './services/hourly-jobs.js';
import { sendStatsSnapshot } from './services/stats-snapshot.js';

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
        players: onlinePlayers,
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

        const respawn = await tryRespawnPlayer(playerRow.id);
        if (respawn.kind === 'wait') {
            ws.close(1008, `Ship destroyed; respawn in ${respawn.remainingSeconds}s`);
            return;
        }
        if (respawn.kind === 'respawned') {
            playerRow = await getPlayerConnectInfo(userId, universeId);
            if (!playerRow) {
                ws.close(1008, 'No player in this universe');
                return;
            }
        }

        const playerId = playerRow.id;
        const sectorId: number = playerRow.current_sector_id;
        const sector: number = playerRow.sector_number;

        if (playerRow.ship_id === null) {
            const granted = await grantStartingShip(playerId, universeId, sectorId, playerRow.name);
            if (granted !== null) {
                playerRow = await getPlayerConnectInfo(userId, universeId);
                if (!playerRow) {
                    ws.close(1008, 'No player in this universe');
                    return;
                }
            }
        }

        await markPlayerLoggedIn(playerId);
        await markUserConnected(userId);
        await markSectorVisited(playerId, sectorId);

        const isAdmin = authPayload.role === 'admin';
        onlinePlayers[playerId] = {
            ws,
            sector,
            sectorId,
            shipId: playerRow.ship_id,
            shipName: playerRow.ship_name,
            name: playerRow.name,
            universeId,
            docked: false,
            inEncounter: false,
            isAdmin,
        };
        const [totalSectors, starbaseSector, guestFlag, onPlanetId] = await Promise.all([
            countSectorsInUniverse(universeId),
            getStarbaseSectorNumber(universeId),
            isGuestUser(userId),
            getOnPlanetId(playerId),
        ]);

        const welcomeLocation = onPlanetId !== null ? 'planet' : 'sector';
        const welcomeMsg: ServerEnvelope = {
            type: ServerTag.Welcome,
            playerId,
            name: playerRow.name,
            sector,
            totalSectors,
            shipTypeName: playerRow.ship_type_slug ?? null,
            coloredShipName: playerRow.ship_display_name ?? null,
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
        await sendStatsSnapshot(playerId);

        const BUCKET_CAPACITY = 50;
        const BUCKET_REFILL_PER_SEC = 20;
        let tokens = BUCKET_CAPACITY;
        let lastRefill = Date.now();

        ws.on('message', async (message) => {
            const now = Date.now();
            tokens = Math.min(
                BUCKET_CAPACITY,
                tokens + ((now - lastRefill) / 1000) * BUCKET_REFILL_PER_SEC,
            );
            lastRefill = now;
            if (tokens < 1) {
                sendEnvelope(playerId, { type: ServerTag.RateLimited });
                return;
            }
            tokens--;

            let raw: unknown;
            try {
                raw = JSON.parse(message.toString());
            } catch {
                sendProtocolError(playerId, 'rejected', 'Invalid JSON');
                logPlayerCommand(
                    playerId,
                    universeId,
                    { type: '<invalid json>' },
                    'rejected',
                ).catch((err) => console.error('Command log error:', err));
                return;
            }

            const parsed = ClientEnvelopeSchema.safeParse(raw);
            if (!parsed.success) {
                const tagRaw =
                    raw && typeof raw === 'object' && 'type' in raw
                        ? (raw as { type: unknown }).type
                        : undefined;
                const tag = typeof tagRaw === 'string' ? tagRaw : '<unknown>';
                const first = parsed.error.issues[0];
                const where = first?.path.join('.') || '<root>';
                sendProtocolError(
                    playerId,
                    'rejected',
                    `Invalid envelope (${tag}): ${where} — ${first?.message}`,
                );
                const rejected =
                    raw && typeof raw === 'object' ? { ...raw, type: tag } : { type: tag };
                logPlayerCommand(playerId, universeId, rejected, 'rejected').catch((err) =>
                    console.error('Command log error:', err),
                );
                return;
            }
            const data: ClientEnvelope = parsed.data;

            let outcome: string;
            try {
                outcome = await routeMessage(playerId, data);
            } catch (err) {
                console.error('Message handler error:', err);
                sendProtocolError(playerId, 'exception', 'Internal server error');
                outcome = 'exception';
            }

            sendStatsSnapshot(playerId).catch((err) => console.error('Stats snapshot error:', err));

            logPlayerCommand(playerId, universeId, data, outcome).catch((err) =>
                console.error('Command log error:', err),
            );
        });

        ws.on('close', () => {
            clearPendingShipPurchase(playerId);
            void import('./handlers/port-haggle.js').then((m) => m.clearHaggleSession(playerId));
            const lastSector = onlinePlayers[playerId]?.sector;
            const lastUniverse = onlinePlayers[playerId]?.universeId;
            delete onlinePlayers[playerId];

            (async () => {
                try {
                    await markPlayerLoggedOut(playerId);
                } catch (err) {
                    console.error('Disconnect cleanup error:', err);
                }
            })();

            if (lastSector && lastUniverse) {
                const clientsToNotify = new Set<WebSocket>();
                for (const p of Object.values(onlinePlayers)) {
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

        const port = process.env.PORT
            ? parseInt(process.env.PORT, 10)
            : devServerPort(worktreeRoot());

        const onListenError = (err: NodeJS.ErrnoException): never => {
            if (err.code === 'EADDRINUSE') {
                console.error(
                    `Port ${port} is already in use — another twnr server is probably ` +
                        `running for this worktree. Stop it (\`pnpm --filter @twnr/server kill:dev\`) ` +
                        `or set PORT to override.`,
                );
            } else {
                console.error('Server error:', err);
            }
            process.exit(1);
        };
        server.on('error', onListenError);
        wss.on('error', onListenError);

        server.listen(port, () => {
            console.log(`Server listening on port ${port}`);
        });
    } catch (error) {
        console.error('Error during server startup:', error);
        throw error;
    }
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
    startServer();
}

export { app, server, wss };
