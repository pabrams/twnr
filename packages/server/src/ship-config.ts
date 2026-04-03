import fs from 'fs';
import path from 'path';

export const shipConfigs: Record<string, any> = {};
try {
    const shipsDir = path.join(process.cwd(), 'config', 'ships');
    const files = fs.readdirSync(shipsDir);
    for (const file of files) {
        if (file.endsWith('.json')) {
            const data = JSON.parse(fs.readFileSync(path.join(shipsDir, file), 'utf-8'));
            shipConfigs[data.name] = data;
        }
    }
} catch (e) {
    console.error('Could not load ship configs', e);
}
