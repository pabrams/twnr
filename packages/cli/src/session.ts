import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type Session = {
    host: string;
    token: string;
    userId: number;
    name?: string;
    universeId?: number;
    isGuest?: boolean;
};

function sessionPath(): string {
    const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
    return join(base, 'twnr-cli', 'session.json');
}

export function loadSession(): Session | null {
    const path = sessionPath();
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8')) as Session;
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
