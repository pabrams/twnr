// Generate JSON Schema files for the WebSocket envelope shapes from the
// zod schemas (the source of truth). Uses zod v4's built-in `z.toJSONSchema`
// — replaces an earlier `ts-json-schema-generator` invocation that couldn't
// follow runtime zod call expressions back to a static TS type.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { ClientEnvelopeSchema, ServerEnvelopeSchema } from '../packages/shared/dist/index.js';

const outputs = [
    ['docs/client-envelopes.schema.json', ClientEnvelopeSchema],
    ['docs/server-envelopes.schema.json', ServerEnvelopeSchema],
];

for (const [path, schema] of outputs) {
    mkdirSync(dirname(path), { recursive: true });
    const json = z.toJSONSchema(schema);
    writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
    console.log(`wrote ${path}`);
}
