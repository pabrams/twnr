import fs from 'fs';
import path from 'path';
import { ShipConfigSchema, type ShipConfig } from '@twnr/shared';
import { loadJsonFile } from './util/load-json.js';

export const SHIPS_DIR = path.join(process.cwd(), 'config', 'templates', 'stock', 'ships');
export const shipConfigs: Record<string, ShipConfig> = {};

export function reloadShipConfigs(): void {
    for (const key of Object.keys(shipConfigs)) delete shipConfigs[key];
    let files: string[];
    try {
        files = fs.readdirSync(SHIPS_DIR);
    } catch (e) {
        console.error('Could not read ship config directory', e);
        return;
    }
    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
            const cfg = loadJsonFile(path.join(SHIPS_DIR, file), ShipConfigSchema);
            shipConfigs[cfg.slug] = cfg;
        } catch (e) {
            console.error((e as Error).message);
        }
    }
}

reloadShipConfigs();
