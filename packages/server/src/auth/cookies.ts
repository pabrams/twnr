import { Request, Response } from 'express';
import { IncomingMessage } from 'http';
import type { AuthTokenPayload } from '@twnr/shared';
import { AUTH_COOKIE_NAME } from './env.js';

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
    if (!cookieHeader) {
        return {};
    }

    const cookies: Record<string, string> = {};
    for (const part of cookieHeader.split(';')) {
        const [rawName, ...rawValue] = part.trim().split('=');
        if (!rawName || rawValue.length === 0) {
            continue;
        }

        try {
            cookies[rawName] = decodeURIComponent(rawValue.join('='));
        } catch {
            cookies[rawName] = rawValue.join('=');
        }
    }

    return cookies;
}

function getCookie(req: Request | IncomingMessage, name: string): string | null {
    const cookieHeader = req.headers.cookie;
    if (typeof cookieHeader !== 'string') {
        return null;
    }

    return parseCookies(cookieHeader)[name] || null;
}

/** Secure flag only in production — dev runs over plain HTTP. */
export function setAuthCookie(res: Response, token: string): void {
    res.cookie(AUTH_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        secure: process.env.NODE_ENV === 'production',
    });
}

function getBearerToken(req: Request): string | null {
    const auth = req.headers['authorization'];
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
        return null;
    }

    return auth.slice(7);
}

export function getJwtToken(req: Request): string | null {
    return getBearerToken(req) || getCookie(req, AUTH_COOKIE_NAME);
}

/** Only valid after authenticateToken middleware has set req.player. */
export function getAuthenticatedPlayer(req: Request): AuthTokenPayload {
    return req.player as AuthTokenPayload;
}
