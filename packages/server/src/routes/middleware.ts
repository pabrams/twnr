import { Request, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { pool } from '../db/index.js';
import type { AuthTokenPayload, ShipConfig } from '@twnr/shared';
import type WebSocket from 'ws';

declare module 'express' {
    interface Request {
        player?: AuthTokenPayload;
    }
}

export interface RouteDeps {
    hashPassword: (password: string) => string;
    verifyPassword: (password: string, storedHash: string | null) => boolean;
    signPlayerToken: (payload: AuthTokenPayload) => string;
    verifyToken: (token: string) => AuthTokenPayload;
    setAuthCookie: (res: Response, token: string) => void;
    getJwtToken: (req: Request) => string | null;
    getAuthenticatedPlayer: (req: Request) => AuthTokenPayload;
    shipConfigs: Record<string, ShipConfig>;
    players: Record<number, { ws: WebSocket; sector: number; name: string }>;
    AUTH_COOKIE_NAME: string;
    ADMIN_API_KEY: string | undefined;
}

export interface Middleware {
    authenticateToken: (req: Request, res: Response, next: NextFunction) => Promise<void>;
    authenticateAdmin: (req: Request, res: Response, next: NextFunction) => void;
    loginLimiter: ReturnType<typeof rateLimit>;
    registerLimiter: ReturnType<typeof rateLimit>;
}

export function createMiddleware(deps: RouteDeps): Middleware {
    const { verifyToken, getJwtToken, ADMIN_API_KEY } = deps;

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

        req.player = payload;
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

            req.player = payload;
            next();
        } catch {
            res.status(403).json({ error: 'Forbidden' });
        }
    }

    const skipRateLimit = process.env.DISABLE_RATE_LIMIT === '1';

    const loginLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 10,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        skip: () => skipRateLimit,
    });

    const registerLimiter = rateLimit({
        windowMs: 60 * 60 * 1000,
        limit: 5,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        skip: () => skipRateLimit,
    });

    return { authenticateToken, authenticateAdmin, loginLimiter, registerLimiter };
}
