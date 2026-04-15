import { Request, Response } from 'express';
import { IncomingMessage } from 'http';
import type { AuthTokenPayload } from '@twnr/shared';
import { AUTH_COOKIE_NAME } from './env.js';

/**
 * Parses a raw `Cookie` header string into a key-value map.
 * @param cookieHeader - The raw cookie header value
 * @returns An object mapping cookie names to their decoded values
 */
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

/**
 * Retrieves a single cookie value from a request.
 * @param req - The HTTP request (Express or raw Node)
 * @param name - The cookie name to look up
 * @returns The cookie value, or `null` if not present
 */
function getCookie(req: Request | IncomingMessage, name: string): string | null {
    const cookieHeader = req.headers.cookie;
    if (typeof cookieHeader !== 'string') {
        return null;
    }

    return parseCookies(cookieHeader)[name] || null;
}

/**
 * Sets the authentication JWT as an HttpOnly cookie on the response.
 * Secure flag is enabled in production. Cookie expires in 7 days.
 * @param res - The Express response object
 * @param token - The signed JWT to store
 */
export function setAuthCookie(res: Response, token: string): void {
    res.cookie(AUTH_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        secure: process.env.NODE_ENV === 'production',
    });
}

/**
 * Extracts a Bearer token from the `Authorization` header.
 * @param req - The Express request
 * @returns The token string, or `null` if not present or malformed
 */
function getBearerToken(req: Request): string | null {
    const auth = req.headers['authorization'];
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
        return null;
    }

    return auth.slice(7);
}

/**
 * Retrieves the JWT from either the `Authorization: Bearer` header or the auth cookie.
 * Bearer token takes precedence over the cookie.
 * @param req - The Express request
 * @returns The JWT string, or `null` if neither source has a token
 */
export function getJwtToken(req: Request): string | null {
    return getBearerToken(req) || getCookie(req, AUTH_COOKIE_NAME);
}

/**
 * Retrieves the authenticated player payload attached by the authenticateToken middleware.
 * @param req - The Express request (with `.player` set by middleware)
 * @returns The authenticated player's token payload
 */
export function getAuthenticatedPlayer(req: Request): AuthTokenPayload {
    return req.player as AuthTokenPayload;
}
