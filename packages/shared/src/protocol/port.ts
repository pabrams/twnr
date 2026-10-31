// Ports: docking, trading, haggling and player-built port construction.

import { z } from 'zod';

import { defineCommand, defineReply, outcomes, variants } from './define.js';

import { Commodity3, Int, Num, Bool, Str, SectorDisplayDataSchema } from './common.js';

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

/** Shared by HaggleCounter and HaggleAccept. */
export const HaggleResponseResult = defineReply(
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
            message: Str,
            turnsUsed: Num.optional(),
        },
        error: {
            message: Str,
        },
    }),
);

export const PortInfo = defineCommand('portInfo', {
    request: {
        sectorId: Int,
    },
    reply: {
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
    },
});

export const Dock = defineCommand('dock', {
    request: {},
    reply: {
        docked: Bool,
        port: PortInfo.reply.Schema.optional(),
        credits: Num.optional(),
        cargo: CargoSchema.optional(),
        emptyHolds: Num.optional(),
        freedFromTow: z.literal(true).optional(),
        shipInfo: ShipInfoEmbedSchema.optional(),
        class0Prices: Class0PriceListSchema.optional(),
    },
});

export const Undock = defineCommand('undock', {
    request: {},
    reply: outcomes({
        success: SectorDisplayDataSchema,
        error: {
            message: Str,
        },
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
        error: {
            message: Str,
        },
    }),
});

export const PortTransaction = defineCommand('portTransaction', {
    request: {
        good: z.string(),
        quantity: Int,
        action: TradeAction,
    },
    reply: {
        credits: Num,
        cargo: CargoSchema,
        emptyHolds: Num,
        turnsUsed: Num.optional(),
        expDelta: Num.optional(),
        repDelta: Num.optional(),
    },
});

export const DockStarbase = defineCommand('dockStarbase', {
    request: {},
    reply: {
        prices: z.array(HardwarePriceItemSchema),
        class0Prices: Class0PriceListSchema,
        credits: Num.optional(),
        shipInfo: ShipInfoEmbedSchema.optional(),
    },
});

export const LeaveStarbase = defineCommand('leaveStarbase', {
    request: {},
    reply: SectorDisplayDataSchema,
});

export const HaggleOpen = defineCommand('haggleOpen', {
    request: {
        commodity: Commodity3,
        quantity: Int,
        action: TradeAction,
    },
    reply: outcomes({
        opened: {
            commodity: Commodity3,
            action: z.enum(['buy', 'sell']),
            quantity: Num,
            initialOffer: Num,
        },
        error: {
            message: Str,
        },
    }),
});

export const HaggleCounter = defineCommand('haggleCounter', {
    request: {
        counter: Int,
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

export const ConstructPortInfo = defineCommand('constructPortInfo', {
    request: {},
    reply: variants('mode', {
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
        hasPort: {},
    }),
});

export const BuildPort = defineCommand('buildPort', {
    request: {
        portClass: Int,
        portName: z.string(),
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
        error: {
            message: Str,
        },
    }),
});

export const UpgradePortInfo = defineCommand('upgradePortInfo', {
    request: {},
    reply: variants('mode', {
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
        noPort: {},
    }),
});

export const UpgradePort = defineCommand('upgradePort', {
    request: {
        commodity: Commodity3,
        units: Int,
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
        error: {
            message: Str,
        },
    }),
});
