import { pool } from '../index.js';
import type { Queryable } from '../types.js';

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

export async function markUserConnected(userId: number, db: Queryable = pool): Promise<void> {
    await db.query('UPDATE users SET last_connected_at = NOW() WHERE id = $1', [userId]);
}

/** Bumping token_version invalidates the user's existing JWTs. */
export async function bumpUserTokenVersion(userId: number, db: Queryable = pool): Promise<void> {
    await db.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [userId]);
}

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

export async function createGuestUser(
    email: string,
    passwordHash: string,
    db: Queryable = pool,
): Promise<UserCreatedRow> {
    const res = await db.query<UserCreatedRow>(
        `INSERT INTO users (email, password_hash, role, is_guest)
         VALUES ($1, $2, 'player', TRUE) RETURNING id, email, role, token_version`,
        [email, passwordHash],
    );
    return res.rows[0];
}

export async function isGuestUser(userId: number, db: Queryable = pool): Promise<boolean> {
    const res = await db.query<{ is_guest: boolean }>('SELECT is_guest FROM users WHERE id = $1', [
        userId,
    ]);
    return res.rows[0]?.is_guest === true;
}

export async function deleteUserById(userId: number, db: Queryable = pool): Promise<void> {
    await db.query('DELETE FROM users WHERE id = $1', [userId]);
}

export async function listExpiredGuests(
    maxIdleDays: number,
    db: Queryable = pool,
): Promise<{ user_id: number; player_id: number }[]> {
    const res = await db.query<{ user_id: number; player_id: number }>(
        `SELECT u.id AS user_id, p.id AS player_id
           FROM users u
           JOIN players p ON p.user_id = u.id
          WHERE u.is_guest = true
            AND COALESCE(p.last_logout_at, p.last_login_at) < NOW() - ($1 || ' days')::interval`,
        [maxIdleDays],
    );
    return res.rows;
}
