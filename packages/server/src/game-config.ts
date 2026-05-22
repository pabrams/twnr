import path from 'path';
import { z } from 'zod';
import { loadJsonFile } from './util/load-json.js';

const CONFIG_DIR = path.join(process.cwd(), 'config', 'templates', 'stock');

function loadConfig<S extends z.ZodType>(file: string, schema: S): z.infer<S> {
    return loadJsonFile(path.join(CONFIG_DIR, file), schema);
}

const Class0PricesSchema = z.object({
    dronePrice: z.number(),
    shieldPrice: z.number(),
    holdBaseCostMin: z.number(),
    holdBaseCostMax: z.number(),
    holdCostPeriodDays: z.number(),
});
export type Class0Prices = z.infer<typeof Class0PricesSchema>;

export const class0Prices: Class0Prices = loadConfig('class0-prices.json', Class0PricesSchema);

/**
 * Per-feature deltas + tuning factors for a player's reputation and
 * experience. `amountChangeFor` values are either a fixed delta (e.g.
 * `destroyPlanet: -1`) or a nested map keyed by some discriminator the
 * caller picks, e.g. `buildPortByClass: { "1": 12, "2": 14, ... }` is
 * looked up by port class. `factorsFor` is plain string → number for
 * formula-driven features (combat, ship destroy, podding).
 */
const AmountChangeValue = z.union([z.number(), z.record(z.string(), z.number())]);
const AttributeDeltasSchema = z.object({
    amountChangeFor: z.record(z.string(), AmountChangeValue),
    factorsFor: z.record(z.string(), z.number()),
});
export type AttributeDeltas = z.infer<typeof AttributeDeltasSchema>;

export const reputationDeltas: AttributeDeltas = loadConfig(
    'reputation.json',
    AttributeDeltasSchema,
);
export const experienceDeltas: AttributeDeltas = loadConfig(
    'experience.json',
    AttributeDeltasSchema,
);

/** Read a scalar (non-nested) entry from an attribute deltas map.
 *  Returns the number when the entry is a plain number, 0 otherwise — covers
 *  both missing keys and the nested-map case (which has its own dedicated
 *  caller, see e.g. `buildPortByClass`). */
export function scalarDelta(deltas: AttributeDeltas, key: string): number {
    const v = deltas.amountChangeFor[key];
    return typeof v === 'number' ? v : 0;
}

/**
 * Per-class generation weights for bigbang. Keys are class numbers as
 * strings ("1".."8"), values are non-negative weights; they're sampled
 * proportionally (don't have to sum to 100, but the stock template does).
 */
const PortClassesSchema = z.object({
    generationShares: z.record(z.string(), z.number()),
});
export type PortClasses = z.infer<typeof PortClassesSchema>;

export const portClassesConfig: PortClasses = loadConfig('port-classes.json', PortClassesSchema);
