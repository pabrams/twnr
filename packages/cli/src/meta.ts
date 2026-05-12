import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ClientTag } from '@twnr/shared';

export function listCommands(): string[] {
    return Object.values(ClientTag).sort();
}

type SchemaFile = { definitions: Record<string, unknown> };
let cached: SchemaFile | null = null;

function loadSchema(): SchemaFile {
    if (cached) return cached;
    const here = dirname(fileURLToPath(import.meta.url));
    const schemaPath = resolve(here, '../../..', 'docs/client-messages.schema.json');
    cached = JSON.parse(readFileSync(schemaPath, 'utf8')) as SchemaFile;
    return cached;
}

/** Strip schema boilerplate that's identical across every wire message:
 *  the outer `type: "object"` and `additionalProperties: false`. They're
 *  meaningful but never vary; hiding them lets the REPL show only the
 *  per-message bits (properties + required). */
function stripBoilerplate(def: unknown): unknown {
    if (!def || typeof def !== 'object') return def;
    const obj = def as Record<string, unknown>;
    const { additionalProperties: _ap, type: _t, ...rest } = obj;
    void _ap;
    void _t;
    return rest;
}

export function showCommand(target: string): unknown | null {
    const schema = loadSchema();
    const match = Object.entries(schema.definitions).find(
        ([, def]) =>
            (def as { properties?: { type?: { const?: string } } }).properties?.type?.const ===
            target,
    );
    return match ? stripBoilerplate(match[1]) : null;
}
