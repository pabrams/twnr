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

// JSON format: `amountChangeFor` values are a fixed delta or a nested map
// keyed by a caller-chosen discriminator (e.g. buildPortByClass keyed by port
// class); `factorsFor` is flat string → number for formula-driven features.
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

/** Scalar entries only: missing keys and nested-map entries both return 0. */
export function scalarDelta(deltas: AttributeDeltas, key: string): number {
    const v = deltas.amountChangeFor[key];
    return typeof v === 'number' ? v : 0;
}

// Keys are class numbers as strings ("1".."8"); weights are sampled
// proportionally and need not sum to 100.
const PortClassesSchema = z.object({
    generationShares: z.record(z.string(), z.number()),
});
export type PortClasses = z.infer<typeof PortClassesSchema>;

export const portClassesConfig: PortClasses = loadConfig('port-classes.json', PortClassesSchema);
