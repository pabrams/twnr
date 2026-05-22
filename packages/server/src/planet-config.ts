import fs from 'fs';
import path from 'path';
import { PlanetConfigSchema, type PlanetConfig } from '@twnr/shared';
import { loadJsonFile } from './util/load-json.js';

export const PLANETS_DIR = path.join(process.cwd(), 'config', 'templates', 'stock', 'planets');
export const planetConfigs: Record<string, PlanetConfig> = {};

export function reloadPlanetConfigs(): void {
    for (const key of Object.keys(planetConfigs)) delete planetConfigs[key];
    let files: string[];
    try {
        files = fs.readdirSync(PLANETS_DIR);
    } catch (e) {
        console.error('Could not read planet config directory', e);
        return;
    }
    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
            const cfg = loadJsonFile(path.join(PLANETS_DIR, file), PlanetConfigSchema);
            planetConfigs[cfg.slug] = cfg;
        } catch (e) {
            console.error((e as Error).message);
        }
    }
}

reloadPlanetConfigs();
