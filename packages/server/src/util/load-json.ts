import fs from 'fs';
import { z } from 'zod';

export function loadJsonFile<S extends z.ZodType>(filePath: string, schema: S): z.infer<S> {
    let raw: string;
    try {
        raw = fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
        throw new Error(`Failed to read ${filePath}: ${(e as Error).message}`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new Error(`${filePath} is not valid JSON: ${(e as Error).message}`);
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
        const issues = result.error.issues
            .map((i) => `  ${i.path.join('.') || '<root>'}: ${i.message}`)
            .join('\n');
        throw new Error(`${filePath} failed schema validation:\n${issues}`);
    }
    return result.data;
}
