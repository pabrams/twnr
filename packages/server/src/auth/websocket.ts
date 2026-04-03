import { Socket } from 'net';
import { IncomingMessage } from 'http';
import { CONFIGURED_WS_ALLOWED_ORIGINS } from './env.js';

/**
 * Returns the list of allowed WebSocket origins. Uses `WS_ALLOWED_ORIGINS` env var
 * if configured, otherwise derives allowed origins from the request's `Host` header.
 * @param req - The incoming HTTP upgrade request
 * @returns Array of allowed origin strings
 */
function getAllowedWebSocketOrigins(req: IncomingMessage): string[] {
    if (CONFIGURED_WS_ALLOWED_ORIGINS.length > 0) {
        return CONFIGURED_WS_ALLOWED_ORIGINS;
    }

    if (typeof req.headers.host !== 'string' || !req.headers.host) {
        return [];
    }

    return [`http://${req.headers.host}`, `https://${req.headers.host}`];
}

/**
 * Checks whether the WebSocket upgrade request's `Origin` header is allowed.
 * Requests with no origin header are permitted (non-browser clients).
 * @param req - The incoming HTTP upgrade request
 * @returns `true` if the origin is allowed or absent
 */
export function isAllowedWebSocketOrigin(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || !origin) {
        return true;
    }

    return getAllowedWebSocketOrigins(req).includes(origin);
}

/**
 * Rejects a WebSocket upgrade by sending a 403 response and destroying the socket.
 * @param socket - The raw TCP socket from the upgrade request
 */
export function rejectWebSocketUpgrade(socket: Socket): void {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
}
