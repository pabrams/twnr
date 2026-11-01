import { makeDomain } from './_domain.js';

/** Player-facing names for the game vocabulary that arrives in refusal details. */
export const LABEL = makeDomain('LABEL', {
    fuel: 'Fuel Ore',
    organics: 'Organics',
    equipment: 'Equipment',
    proximity: 'Proximity',
    seeker: 'Limpet',
});

const LABELED_DETAIL_KEYS = new Set(['commodity', 'group', 'mineType']);

export function labelRefusalDetail(detail: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(detail)) {
        out[key] =
            LABELED_DETAIL_KEYS.has(key) && typeof value === 'string' && value in LABEL
                ? LABEL[value as keyof typeof LABEL]
                : value;
    }
    return out;
}
