import fs from 'fs';
import path from 'path';

const CONFIG_DIR = path.join(process.cwd(), 'config');

function loadJson<T>(file: string, fallback: T): T {
    try {
        return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, file), 'utf-8'));
    } catch (e) {
        console.error(`Could not load config/${file}, using defaults`, e);
        return fallback;
    }
}

export const newPlayerConfig = loadJson('new-player.json', {
    startingShip: 'Merchant Freighter',
    startingCredits: 10000,
    startingFighters: 0,
    startingShields: 0,
    startingSector: 1,
});

export const class0Prices = loadJson('class0-prices.json', {
    fighterPrice: 20,
    shieldPrice: 10,
    holdPrice: 50,
});

export const initialValues = loadJson('initial-values.json', {
    earthColonists: 1000000,
});
