import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { ClientTag } from '@twnr/shared';

export function listCommands(): string[] {
    return Object.values(ClientTag).sort();
}
const VariantSchema = z.object({
    properties: z.object({
        type: z.object({ const: z.string() }).loose(),
    }).loose(),
}).loose();

const SchemaFileSchema = z.object({
    oneOf: z.array(VariantSchema),
});

type SchemaFile = z.infer<typeof SchemaFileSchema>;
let cached: SchemaFile | null = null;

function loadSchema(): SchemaFile {
    if (cached) return cached;
    const here = dirname(fileURLToPath(import.meta.url));
    const schemaPath = resolve(here, '../../..', 'docs/client-envelopes.schema.json');
    const raw = JSON.parse(readFileSync(schemaPath, 'utf8'));
    cached = SchemaFileSchema.parse(raw);
    return cached;
}

/** Strip schema boilerplate that's identical across every wire message:
 *  the outer `type: "object"` and `additionalProperties: false`. . */
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
    const match = schema.oneOf.find(
        (def) => def.properties.type.const == target);

    return match ? stripBoilerplate(match) : null;
}
