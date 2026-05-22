import { z } from 'zod';
import { saveSession, type Session } from './session.js';

const GuestResponseSchema = z.object({
    userId: z.number(),
    name: z.string(),
    role: z.string(),
    token: z.string(),
    universeId: z.number(),
    isGuest: z.literal(true),
});

const LoginResponseSchema = z.object({
    userId: z.number(),
    role: z.string(),
    token: z.string(),
});

const RegisterResponseSchema = z.object({
    userId: z.number(),
    name: z.string(),
    role: z.string(),
    token: z.string(),
});

async function postJson<S extends z.ZodType>(
    url: string,
    body: unknown,
    schema: S,
): Promise<z.infer<S>> {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`POST ${url} -> ${res.status}: ${text}`);
    }
    const parsed = schema.safeParse(JSON.parse(text));
    if (!parsed.success) {
        const issues = parsed.error.issues
            .map((i) => `  ${i.path.join('.') || '<root>'}: ${i.message}`)
            .join('\n');
        throw new Error(`POST ${url} returned unexpected shape:\n${issues}`);
    }
    return parsed.data;
}

export async function loginGuest(host: string): Promise<Session> {
    const data = await postJson(`${host}/api/auth/guest`, {}, GuestResponseSchema);
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
    const data = await postJson(`${host}/api/auth/login`, { email, password }, LoginResponseSchema);
    const session: Session = {
        host,
        token: data.token,
        userId: data.userId,
        isGuest: false,
    };
    saveSession(session);
    return session;
}

export async function register(
    host: string,
    name: string,
    email: string,
    password: string,
): Promise<Session> {
    const data = await postJson(
        `${host}/api/auth/register`,
        { name, email, password },
        RegisterResponseSchema,
    );
    const session: Session = {
        host,
        token: data.token,
        userId: data.userId,
        name: data.name,
        isGuest: false,
    };
    saveSession(session);
    return session;
}
