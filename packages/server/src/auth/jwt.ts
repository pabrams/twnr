import jwt from 'jsonwebtoken';
import type { AuthTokenPayload } from '@twnr/shared';
import { JWT_SECRET } from './env.js';

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
