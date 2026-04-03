import fs from 'fs';
import path from 'path';

export const SHIPS_DIR = path.join(process.cwd(), 'config', 'ships');
export const shipConfigs: Record<string, any> = {};

export function reloadShipConfigs(): void {
    for (const key of Object.keys(shipConfigs)) delete shipConfigs[key];
    try {
        const files = fs.readdirSync(SHIPS_DIR);
        for (const file of files) {
            if (file.endsWith('.json')) {
                const data = JSON.parse(fs.readFileSync(path.join(SHIPS_DIR, file), 'utf-8'));
                shipConfigs[data.name] = data;
            }
        }
    } catch (e) {
        console.error('Could not load ship configs', e);
    }
}

reloadShipConfigs();
