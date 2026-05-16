import fs from 'fs';
import path from 'path';
import type { PlanetConfig } from '@twnr/shared';

export const PLANETS_DIR = path.join(process.cwd(), 'config', 'templates', 'stock', 'planets');
export const planetConfigs: Record<string, PlanetConfig> = {};

export function reloadPlanetConfigs(): void {
    for (const key of Object.keys(planetConfigs)) delete planetConfigs[key];
    try {
        const files = fs.readdirSync(PLANETS_DIR);
        for (const file of files) {
            if (file.endsWith('.json')) {
                const data = JSON.parse(fs.readFileSync(path.join(PLANETS_DIR, file), 'utf-8'));
                planetConfigs[data.type] = data;
            }
        }
    } catch (e) {
        console.error('Could not load planet configs', e);
    }
}

reloadPlanetConfigs();
