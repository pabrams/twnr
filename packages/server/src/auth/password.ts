import crypto from 'crypto';

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
