import { pool } from '../index.js';
import type { Queryable } from '../types.js';

/** Fetch the token_version for a user (to validate JWT on connect). */
export async function getUserTokenVersion(
    userId: number,
    db: Queryable = pool,
): Promise<number | undefined> {
    const res = await db.query<{ token_version: number }>(
        'SELECT token_version FROM users WHERE id = $1',
        [userId],
    );
    return res.rows[0]?.token_version;
}

/** Stamp a user's last_connected_at to NOW(). */
export async function markUserConnected(userId: number, db: Queryable = pool): Promise<void> {
    await db.query('UPDATE users SET last_connected_at = NOW() WHERE id = $1', [userId]);
}

/** Bump a user's token_version, invalidating their existing JWT(s). */
export async function bumpUserTokenVersion(userId: number, db: Queryable = pool): Promise<void> {
    await db.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [userId]);
}

/** Look up a user by email for login verification. */
export type UserLoginRow = {
    id: number;
    role: string;
    password_hash: string | null;
    token_version: number;
};
export async function getUserByEmail(
    email: string,
    db: Queryable = pool,
): Promise<UserLoginRow | undefined> {
    const res = await db.query<UserLoginRow>(
        'SELECT id, role, password_hash, token_version FROM users WHERE email = $1',
        [email],
    );
    return res.rows[0];
}

/** Create a new user account. Returns the freshly-inserted row. */
export type UserCreatedRow = {
    id: number;
    email: string;
    role: string;
    token_version: number;
};
export async function createUser(
    email: string,
    passwordHash: string,
    role: string,
    db: Queryable = pool,
): Promise<UserCreatedRow> {
    const res = await db.query<UserCreatedRow>(
        `INSERT INTO users (email, password_hash, role)
         VALUES ($1, $2, $3) RETURNING id, email, role, token_version`,
        [email, passwordHash, role],
    );
    return res.rows[0];
}
