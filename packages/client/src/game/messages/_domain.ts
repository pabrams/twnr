import { getTemplate } from '../renderer.js';

/**
 * Wraps a domain's template object in a Proxy so every property access goes
 * through the live registry. After an HMR update rebuilds the registry,
 * consumers holding references to the domain (e.g. `const tpl = PANEL.foo;`)
 * still see the new template because the proxy re-reads on each `.get`.
 *
 * Falls back to the static object when the registry is empty (during initial
 * module load, before `registerTemplates` runs).
 */
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
