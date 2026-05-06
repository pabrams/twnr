import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ClientMsgType } from '@twnr/shared';

export function listCommands(): string[] {
    return Object.values(ClientMsgType).sort();
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

export function showCommand(target: string): unknown | null {
    const schema = loadSchema();
    const match = Object.entries(schema.definitions).find(
        ([, def]) =>
            (def as { properties?: { type?: { const?: string } } }).properties?.type?.const ===
            target,
    );
    return match ? match[1] : null;
}
