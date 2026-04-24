import fs from 'fs';
import path from 'path';

const CONFIG_DIR = path.join(process.cwd(), 'config');

/**
 * Load a JSON file from `config/`. Throws if the file is missing or malformed
 * — the JSON files are committed to the repo and shipped with every build, so
 * a missing one is a deployment bug we want to fail loudly on rather than
 * silently fall back to a duplicate set of in-code defaults.
 */
function loadJson<T>(file: string): T {
    const fullPath = path.join(CONFIG_DIR, file);
    let raw: string;
    try {
        raw = fs.readFileSync(fullPath, 'utf-8');
    } catch (e) {
        throw new Error(`Failed to read required config file ${fullPath}: ${(e as Error).message}`);
    }
    try {
        return JSON.parse(raw);
    } catch (e) {
        throw new Error(`config/${file} is not valid JSON: ${(e as Error).message}`);
    }
}

export interface NewPlayerConfig {
    startingShip: string;
    startingCredits: number;
    startingDrones: number;
    startingShields: number;
    startingSector: number;
}

export interface Class0Prices {
    dronePrice: number;
    shieldPrice: number;
    holdPrice: number;
}

export const newPlayerConfig: NewPlayerConfig = loadJson<NewPlayerConfig>('new-player.json');
export const class0Prices: Class0Prices = loadJson<Class0Prices>('class0-prices.json');
