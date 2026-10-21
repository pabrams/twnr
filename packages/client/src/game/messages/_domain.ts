import { getTemplate } from '../renderer.js';

/** Proxy re-reads the live registry per access so held references survive HMR rebuilds. */
export function makeDomain<T extends Record<string, string>>(
    domain: string,
    staticTemplates: T,
): T {
    return new Proxy(staticTemplates, {
        get(target, key) {
            if (typeof key !== 'string') {
                return (target as Record<string | symbol, unknown>)[key as unknown as string];
            }
            const live = getTemplate(`${domain}.${key}`);
            return live ?? target[key as keyof T];
        },
    }) as T;
}
