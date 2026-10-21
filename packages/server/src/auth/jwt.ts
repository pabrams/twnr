import jwt from 'jsonwebtoken';
import type { AuthTokenPayload } from '@twnr/shared';
import { JWT_SECRET } from './env.js';

export function signPlayerToken(payload: AuthTokenPayload): string {
    return jwt.sign(payload, JWT_SECRET, {
        algorithm: 'HS256',
        expiresIn: '7d',
    });
}

/** Throws on an invalid, expired, or malformed token. */
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
