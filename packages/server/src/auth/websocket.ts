import { Socket } from 'net';
import { IncomingMessage } from 'http';
import { CONFIGURED_WS_ALLOWED_ORIGINS } from './env.js';

function getAllowedWebSocketOrigins(req: IncomingMessage): string[] {
    if (CONFIGURED_WS_ALLOWED_ORIGINS.length > 0) {
        return CONFIGURED_WS_ALLOWED_ORIGINS;
    }

    if (typeof req.headers.host !== 'string' || !req.headers.host) {
        return [];
    }

    return [`http://${req.headers.host}`, `https://${req.headers.host}`];
}

/** Requests with no Origin header are permitted (non-browser clients). */
export function isAllowedWebSocketOrigin(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || !origin) {
        return true;
    }

    return getAllowedWebSocketOrigins(req).includes(origin);
}

export function rejectWebSocketUpgrade(socket: Socket): void {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
}
