// Ports: docking, trading, haggling and player-built port construction.

import { z } from 'zod';

import { defineCommand, defineNamedReply, outcomes } from './define.js';

import {
    Commodity3,
    Int,
    Num,
    Bool,
    Str,
    SectorDisplayDataSchema,
    PositiveInt,
    SectorNumber,
    PortName,
} from './common.js';

export const CargoSchema = z.object({
    fuel: Num,
    organics: Num,
    equipment: Num,
    colonists: Num,
});

export const ShipInfoEmbedSchema = z.object({
    shipTypeName: Str,
    drones: Num,
    maxDrones: Num,
    shields: Num,
    maxShields: Num,
    holds: Num,
    maxHolds: Num,
});

/** holdBaseCost/holdCostIncrement are hold-pricing.ts inputs, not a unit price. */
export const Class0PriceListSchema = z.object({
    dronePrice: Num,
    shieldPrice: Num,
    holdBaseCost: Num,
    holdCostIncrement: Num,
});

export type Class0PriceList = z.infer<typeof Class0PriceListSchema>;

export const HardwarePriceItemSchema = z.object({
    name: Str,
    label: Str,
    price: Num,
});

export type HardwarePriceItem = z.infer<typeof HardwarePriceItemSchema>;

export const TradeAction = z.enum(['buy', 'sell']);

export const HaggleResponseResult = defineNamedReply(
    'haggleResponseResult',
    outcomes({
        accepted: {
            finalTotal: Num,
            credits: Num,
            cargo: CargoSchema,
            emptyHolds: Num,
            turnsUsed: Num.optional(),
            expDelta: Num.optional(),
            repDelta: Num.optional(),
        },
        counter: {
            newPortOffer: Num,
        },
        final: {
            newPortOffer: Num,
        },
        rejected: {
            turnsUsed: Num.optional(),
        },
    }),
);

/** Also embedded in DockResult.port. */
export const PortInfoSchema = z.object({
    sectorId: Int,
    portName: Str,
    class: Int,
    fuel: Num,
    fuelMax: Num,
    fuelPrice: Num,
    organics: Num,
    orgMax: Num,
    orgPrice: Num,
    equipment: Num,
    equMax: Num,
    equPrice: Num,
});
export type PortInfo = z.infer<typeof PortInfoSchema>;

export const PortInfo = defineCommand('portInfo', {
    request: {
        sectorId: SectorNumber,
    },
    reply: outcomes({
        ok: PortInfoSchema,
    }),
});

export const Dock = defineCommand('dock', {
    request: {},
    reply: outcomes({
        ok: {
            docked: Bool,
            port: PortInfoSchema.optional(),
            credits: Num.optional(),
            cargo: CargoSchema.optional(),
            emptyHolds: Num.optional(),
            freedFromTow: z.literal(true).optional(),
            shipInfo: ShipInfoEmbedSchema.optional(),
            class0Prices: Class0PriceListSchema.optional(),
        },
    }),
});

export const Undock = defineCommand('undock', {
    request: {},
    reply: outcomes({
        success: SectorDisplayDataSchema,
    }),
});

export const Jettison = defineCommand('jettison', {
    request: {},
    reply: outcomes({
        success: {
            jettisoned: CargoSchema,
            expDelta: Num.optional(),
            repDelta: Num.optional(),
        },
    }),
});

export const PortTransaction = defineCommand('portTransaction', {
    request: {
        good: Commodity3,
        quantity: PositiveInt,
        action: TradeAction,
    },
    reply: outcomes({
        ok: {
            credits: Num,
            cargo: CargoSchema,
            emptyHolds: Num,
            turnsUsed: Num.optional(),
            expDelta: Num.optional(),
            repDelta: Num.optional(),
        },
    }),
});

export const DockStarbase = defineCommand('dockStarbase', {
    request: {},
    reply: outcomes({
        ok: {
            prices: z.array(HardwarePriceItemSchema),
            class0Prices: Class0PriceListSchema,
            credits: Num.optional(),
            shipInfo: ShipInfoEmbedSchema.optional(),
        },
    }),
});

export const LeaveStarbase = defineCommand('leaveStarbase', {
    request: {},
    reply: outcomes({
        ok: SectorDisplayDataSchema,
    }),
});

export const HaggleOpen = defineCommand('haggleOpen', {
    request: {
        commodity: Commodity3,
        quantity: PositiveInt,
        action: TradeAction,
    },
    reply: outcomes({
        opened: {
            commodity: Commodity3,
            action: z.enum(['buy', 'sell']),
            quantity: Num,
            initialOffer: Num,
        },
    }),
});

export const HaggleCounter = defineCommand('haggleCounter', {
    request: {
        counter: PositiveInt,
    },
    reply: HaggleResponseResult,
});

export const HaggleAccept = defineCommand('haggleAccept', {
    request: {},
    reply: HaggleResponseResult,
});

export const HaggleQuit = defineCommand('haggleQuit', {
    request: {},
    reply: null,
});

/** What can be done about a port here: build one, or upgrade the existing one. */
export const ConstructPortInfo = defineCommand('constructPortInfo', {
    request: {},
    reply: outcomes({
        build: {
            classes: z.array(
                z.object({
                    portClass: Int,
                    code: Str,
                    credits: Num,
                    ore: Num,
                    org: Num,
                    equ: Num,
                    days: Num,
                    dailyOre: Num,
                    dailyOrg: Num,
                    dailyEqu: Num,
                }),
            ),
            initialProductivity: Num,
            credits: Num,
            existingConstruction: z
                .object({
                    portClass: Int,
                    portName: Str,
                    daysCompleted: Num,
                    daysRequired: Num,
                })
                .optional(),
        },
        noPlanet: {},
        upgrade: {
            portName: Str,
            portClass: Int,
            credits: Num,
            commodities: z.array(
                z.object({
                    commodity: Commodity3,
                    action: z.enum(['B', 'S']),
                    currentProd: Num,
                    currentMax: Num,
                    currentStock: Num,
                    currentTradingPct: Num,
                    unitCost: Num,
                }),
            ),
        },
    }),
});

export const BuildPort = defineCommand('buildPort', {
    request: {
        portClass: Int.min(1).max(8),
        portName: PortName,
    },
    reply: outcomes({
        started: {
            portClass: Int,
            portName: Str,
            daysRequired: Num,
            credits: Num,
            experienceGained: Num,
            reputationGained: Num,
        },
    }),
});

export const UpgradePort = defineCommand('upgradePort', {
    request: {
        commodity: Commodity3,
        units: PositiveInt,
    },
    reply: outcomes({
        upgraded: {
            commodity: Commodity3,
            units: Num,
            creditsSpent: Num,
            credits: Num,
            experienceGained: Num,
            reputationGained: Num,
            newProd: Num,
            newMax: Num,
            newStock: Num,
        },
    }),
});
