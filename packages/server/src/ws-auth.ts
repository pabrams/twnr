import { Request, Response } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Socket } from 'net';
import { IncomingMessage } from 'http';

import type { AuthTokenPayload } from '@twnr/shared';

/**
 * Retrieves a required environment variable or throws if missing.
 * @param name - The environment variable name
 * @returns The environment variable value
 * @throws {Error} If the variable is not set
 */
function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} environment variable is required`);
    }

    return value;
}

const JWT_SECRET = requireEnv('JWT_SECRET');
export const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
export const AUTH_COOKIE_NAME = 'twnr_auth';
const CONFIGURED_WS_ALLOWED_ORIGINS = (process.env.WS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

/**
 * Hashes a password using scrypt with a random 16-byte salt.
 * Output format: `scrypt$<base64url-salt>$<base64url-derived-key>`
 * @param password - The plaintext password to hash
 * @returns The formatted hash string
 */
export function hashPassword(password: string): string {
    const salt = crypto.randomBytes(16);
    const derivedKey = crypto.scryptSync(password, salt, 64);
    return `scrypt$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
}

/**
 * Verifies a plaintext password against a stored scrypt hash using constant-time comparison.
 * @param password - The plaintext password to verify
 * @param storedHash - The stored hash in `scrypt$salt$key` format, or null
 * @returns `true` if the password matches
 */
export function verifyPassword(password: string, storedHash: string | null): boolean {
    if (!storedHash || !storedHash.startsWith('scrypt$')) {
        return false;
    }

    const parts = storedHash.split('$');
    if (parts.length !== 3) {
        return false;
    }

    const salt = Buffer.from(parts[1], 'base64url');
    const expected = Buffer.from(parts[2], 'base64url');
    const actual = crypto.scryptSync(password, salt, expected.length);

    return crypto.timingSafeEqual(actual, expected);
}

/**
 * Signs a JWT for a player with HS256 and a 7-day expiry.
 * @param payload - The token payload containing player identity and role
 * @returns The signed JWT string
 */
export function signPlayerToken(payload: AuthTokenPayload): string {
    return jwt.sign(payload, JWT_SECRET, {
        algorithm: 'HS256',
        expiresIn: '7d',
    });
}

/**
 * Verifies and decodes a JWT, validating its structure and payload fields.
 * @param token - The JWT string to verify
 * @returns The decoded auth payload
 * @throws {Error} If the token is invalid, expired, or has malformed payload
 */
export function verifyToken(token: string): AuthTokenPayload {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });

    if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid token payload');
    }

    const userId = Number((payload as jwt.JwtPayload).userId);
    if (!Number.isInteger(userId) || userId <= 0) {
        throw new Error('Invalid token payload');
    }

    const tokenVersion = (payload as jwt.JwtPayload).tokenVersion;
    if (typeof tokenVersion !== 'number') {
        throw new Error('Invalid token payload');
    }

    return {
        userId,
        name:
            typeof (payload as jwt.JwtPayload).name === 'string'
                ? (payload as jwt.JwtPayload).name
                : undefined,
        role:
            typeof (payload as jwt.JwtPayload).role === 'string'
                ? (payload as jwt.JwtPayload).role
                : undefined,
        tokenVersion,
    };
}

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
    return (req as any).player as AuthTokenPayload;
}
