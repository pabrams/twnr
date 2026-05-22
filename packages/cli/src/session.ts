import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';

export const SessionSchema = z.object({
    host: z.string(),
    token: z.string(),
    userId: z.number(),
    name: z.string().optional(),
    universeId: z.number().optional(),
    isGuest: z.boolean().optional(),
});
export type Session = z.infer<typeof SessionSchema>;

function sessionPath(): string {
    const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
    return join(base, 'twnr-cli', 'session.json');
}

export function loadSession(): Session | null {
    const path = sessionPath();
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const result = SessionSchema.safeParse(raw);
    if (!result.success) {
        console.error(`Session file at ${path} is malformed:`, result.error.issues);
        return null;
    }
    return result.data;
}

export function saveSession(s: Session): string {
    const path = sessionPath();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify(s, null, 2), { mode: 0o600 });
    return path;
}

export function clearSession(): boolean {
    const path = sessionPath();
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
}
