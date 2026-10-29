import { describe, it, expect } from 'vitest';
import type { GalacticNewsEntry } from '@twnr/shared';
import {
    buildNewsLines,
    formatStardate,
    parseStardate,
    renderNewsEvent,
} from '../src/game/display-news.js';

const STRIP_ANSI = /\x1b\[[0-9;]*m/g;
const plain = (s: string) => s.replace(STRIP_ANSI, '');

function entryOn(id: number, when: Date, name: string): GalacticNewsEntry {
    return {
        id,
        createdAt: when.toISOString(),
        event: { kind: 'player_joined_universe', player: { playerId: id, name } },
    };
}

describe('stardate parsing and formatting', () => {
    it('round-trips YYYY/MM/DD at local midnight', () => {
        const d = parseStardate('2026/10/31');
        expect(d).not.toBeNull();
        expect(d!.getHours()).toBe(0);
        expect(formatStardate(d!)).toBe('2026/10/31');
    });

    it('rejects malformed and impossible dates', () => {
        expect(parseStardate('10/31/2026')).toBeNull();
        expect(parseStardate('2026-10-31')).toBeNull();
        expect(parseStardate('2026/02/30')).toBeNull();
        expect(parseStardate('')).toBeNull();
    });
});

describe('buildNewsLines', () => {
    it('heads every day from the start date through today, including empty days', () => {
        const today = new Date(2026, 9, 31);
        const from = new Date(2026, 9, 29);
        const entries = [
            entryOn(1, new Date(2026, 9, 29, 8), 'Alice'),
            entryOn(2, new Date(2026, 9, 31, 23, 59), 'Bob'),
        ];
        const lines = buildNewsLines(entries, from, today).map(plain);
        expect(lines).toEqual([
            '   -=-=-=-=-=-=-=- Galactic News, Stardate 2026/10/29 -=-=-=-=-=-=-=-',
            'Alice has entered the galaxy.',
            '   -=-=-=-=-=-=-=- Galactic News, Stardate 2026/10/30 -=-=-=-=-=-=-=-',
            '   -=-=-=-=-=-=-=- Galactic News, Stardate 2026/10/31 -=-=-=-=-=-=-=-',
            'Bob has entered the galaxy.',
        ]);
    });

    it('shows a single header when reading only today', () => {
        const today = new Date(2026, 9, 31);
        const lines = buildNewsLines([], today, today).map(plain);
        expect(lines).toEqual([
            '   -=-=-=-=-=-=-=- Galactic News, Stardate 2026/10/31 -=-=-=-=-=-=-=-',
        ]);
    });
});

describe('renderNewsEvent', () => {
    it('renders ship type display names and clan labels', () => {
        const combat = renderNewsEvent({
            kind: 'player_ship_destroyed_by_ship_combat',
            attacker: { playerId: 1, name: 'Alice' },
            victim: { playerId: 2, name: 'Bob' },
            destroyedShipType: { slug: 'Vulpeculan Cruiser', displayName: '[g]Cargo Freighter[/g]' },
            sectorNumber: 7,
        });
        expect(plain(combat)).toBe("Alice destroyed Bob's Cargo Freighter!");

        const mined = renderNewsEvent({
            kind: 'player_ship_destroyed_by_sector_defenses',
            victim: { playerId: 2, name: 'Bob' },
            destroyedShipType: { slug: 'Hydra Skiff', displayName: null },
            defenseType: 'mines',
            defenseOwner: { kind: 'clan', clanId: 3, clanNumber: 2, name: 'Raiders' },
            sectorNumber: 7,
        });
        expect(plain(mined)).toBe("Bob's Hydra Skiff was destroyed by mines belonging to #2 Raiders!");

        const rogue = renderNewsEvent({
            kind: 'port_built',
            portId: 9,
            portName: 'Trade Hub',
            sectorNumber: 42,
            owner: { kind: 'rogue' },
        });
        expect(plain(rogue)).toBe('A new port has opened in sector 42.');
    });
});
