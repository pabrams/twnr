import fs from 'fs';
import path from 'path';

export const planetConfigs: Record<string, any> = {};
try {
    const planetsDir = path.join(process.cwd(), 'config', 'planets');
    const files = fs.readdirSync(planetsDir);
    for (const file of files) {
        if (file.endsWith('.json')) {
            const data = JSON.parse(fs.readFileSync(path.join(planetsDir, file), 'utf-8'));
            planetConfigs[data.type] = data;
        }
    }
} catch (e) {
    console.error('Could not load planet configs', e);
}
