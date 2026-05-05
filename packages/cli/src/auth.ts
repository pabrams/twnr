import { saveSession, type Session } from './session.js';

type GuestResponse = {
    userId: number;
    name: string;
    role: string;
    token: string;
    universeId: number;
    isGuest: true;
};

type LoginResponse = {
    userId: number;
    role: string;
    token: string;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`POST ${url} -> ${res.status}: ${text}`);
    }
    return JSON.parse(text) as T;
}

export async function loginGuest(host: string): Promise<Session> {
    const data = await postJson<GuestResponse>(`${host}/api/auth/guest`, {});
    const session: Session = {
        host,
        token: data.token,
        userId: data.userId,
        name: data.name,
        universeId: data.universeId,
        isGuest: true,
    };
    saveSession(session);
    return session;
}

export async function login(host: string, email: string, password: string): Promise<Session> {
    const data = await postJson<LoginResponse>(`${host}/api/auth/login`, { email, password });
    const session: Session = {
        host,
        token: data.token,
        userId: data.userId,
        isGuest: false,
    };
    saveSession(session);
    return session;
}
