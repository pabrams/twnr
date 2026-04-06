import express from 'express';
import { Socket } from 'net';
import helmet from 'helmet';
import { createServer, Server, IncomingMessage } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { connectDB, pool } from './db/index.js';
import { createRoutes } from './routes/index.js';
import * as auth from './auth/index.js';
import { ServerMsgType } from '@twnr/shared';
import type { AuthTokenPayload, ServerResult } from '@twnr/shared';
import { shipConfigs } from './ship-config.js';
import { players, send, broadcastTo } from './game-state.js';
import { handleMessage } from './handlers/message-router.js';

const app: ReturnType<typeof express> = express();
app.use(helmet());
app.use(express.json());
const server: Server = createServer(app);
const wss = new WebSocketServer({ server });

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

        // Require universe parameter
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

wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    console.log('New WebSocket client connected');
    const cookies = auth.parseCookies(req.headers.cookie);
    let authPayload: AuthTokenPayload;
    try {
        authPayload = auth.verifyToken(cookies[auth.AUTH_COOKIE_NAME] || '');
    } catch {
        ws.close(1008, 'Authentication required');
        return;
    }

    const userId = authPayload.userId;

    // Parse universe from query string
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
        // Look up user's token version
        const userRes = await pool.query('SELECT token_version FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0) {
            ws.close(1008, 'User not found');
            return;
        }
        if (userRes.rows[0].token_version !== authPayload.tokenVersion) {
            ws.close(1008, 'Token has been revoked');
            return;
        }

        // Look up player for this user in this universe
        const playerRes = await pool.query(
            'SELECT id, name, current_sector FROM players WHERE user_id = $1 AND universe_id = $2',
            [userId, universeId],
        );
        if (playerRes.rows.length === 0) {
            ws.close(1008, 'No player in this universe');
            return;
        }
        const playerRow = playerRes.rows[0];
        const playerId = playerRow.id;
        const sector: number = playerRow.current_sector;

        // Undock on connect (in case of prior disconnect while docked)
        await pool.query('UPDATE players SET docked = FALSE WHERE id = $1', [playerId]);
        // Mark current sector as visited
        await pool.query(
            'INSERT INTO visited_sectors (player_id, sector_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [playerId, sector],
        );
        players[playerId] = { ws, sector, name: playerRow.name, universeId, docked: false };
        const sectorCountRes = await pool.query(
            'SELECT COUNT(*) FROM sectors WHERE universe_id = $1',
            [universeId],
        );
        const totalSectors = parseInt(sectorCountRes.rows[0].count, 10);
        const welcomeMsg: ServerResult = {
            type: ServerMsgType.Welcome,
            playerId,
            name: playerRow.name,
            sector,
            totalSectors,
            token: auth.signPlayerToken({
                userId,
                name: playerRow.name,
                role: authPayload.role,
                tokenVersion: userRes.rows[0].token_version,
            }),
        };
        ws.send(JSON.stringify(welcomeMsg));
        console.log(`${playerId} connected.`);

        let tokens = 50;
        const refillInterval = setInterval(() => {
            tokens = Math.min(50, tokens + 20);
        }, 1000);

        ws.on('message', async (message) => {
            if (tokens <= 0) {
                send(ws, { type: ServerMsgType.RateLimited });
                return;
            }
            tokens--;

            let data: any;
            try {
                data = JSON.parse(message.toString());
            } catch {
                send(ws, { type: ServerMsgType.Error, message: 'Invalid JSON' });
                return;
            }

            try {
                await handleMessage(ws, playerId, data);
            } catch (err) {
                console.error('Message handler error:', err);
                send(ws, { type: ServerMsgType.Error, message: 'Internal server error' });
            }
        });

        ws.on('close', () => {
            clearInterval(refillInterval);
            const lastSector = players[playerId]?.sector;
            const lastUniverse = players[playerId]?.universeId;
            delete players[playerId];

            if (lastSector && lastUniverse) {
                const clientsToNotify = new Set<WebSocket>();
                for (const p of Object.values(players)) {
                    if (p.sector === lastSector && p.universeId === lastUniverse) {
                        clientsToNotify.add(p.ws);
                    }
                }
                broadcastTo({ type: ServerMsgType.PlayerLeft, playerId }, clientsToNotify);
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

        server.listen(3000, () => {
            console.log('Server listening on port 3000');
        });
    } catch (error) {
        console.error('Error during server startup:', error);
        process.exit(1);
    }
}

// Only start the server if this file is run directly
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
    startServer();
}

export { app, server, wss };
