/**
 * Retrieves a required environment variable or throws if missing.
 * @param name - The environment variable name
 * @returns The environment variable value
 * @throws {Error} If the variable is not set
 */
export function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} environment variable is required`);
    }

    return value;
}

export const JWT_SECRET = requireEnv('JWT_SECRET');
export const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
export const AUTH_COOKIE_NAME = 'twnr_auth';
export const CONFIGURED_WS_ALLOWED_ORIGINS = (process.env.WS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
