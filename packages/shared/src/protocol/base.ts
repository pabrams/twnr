// Planetary defense bastions: construction, treasury and the bwarp transporter.

import { z } from 'zod';

import { defineCommand, outcomes, variants } from './define.js';

import { Int, Num, Str } from './common.js';

export const BaseInfo = defineCommand('baseInfo', {
    request: {},
    reply: variants('mode', {
        noBase: {
            planetClass: Str,
            planetTypeDisplay: Str,
            level1: z.object({
                fuel: Num,
                org: Num,
                equ: Num,
                colos: Num,
                days: Num,
            }),
            planetStock: z.object({
                fuel: Num,
                org: Num,
                equ: Num,
                colos: Num,
            }),
        },
        constructing: {
            targetLevel: Int,
            startedAt: Str,
            completesAt: Str,
        },
        exists: {
            level: Int,
        },
        error: {
            message: Str,
        },
    }),
});

export const BuildBase = defineCommand('buildBase', {
    request: {},
    reply: outcomes({
        started: {
            targetLevel: Int,
            daysRequired: Num,
            completesAt: Str,
        },
        error: {
            message: Str,
            shortfall: z
                .object({
                    fuel: Num.optional(),
                    org: Num.optional(),
                    equ: Num.optional(),
                    colos: Num.optional(),
                })
                .optional(),
        },
    }),
});

export const ExitBase = defineCommand('exitBase', {
    request: {},
    reply: {},
});

export const TreasuryInfo = defineCommand('treasuryInfo', {
    request: {},
    reply: outcomes({
        ok: {
            level: Int,
            treasury: Num,
            credits: Num,
        },
        error: {
            message: Str,
        },
    }),
});

export const TreasuryTransfer = defineCommand('treasuryTransfer', {
    request: {
        direction: z.enum(['to', 'from']),
        amount: Int,
    },
    reply: outcomes({
        ok: {
            direction: z.enum(['to', 'from']),
            amount: Num,
            credits: Num,
            treasury: Num,
        },
        error: {
            message: Str,
        },
    }),
});

export const BwarpInfo = defineCommand('bwarpInfo', {
    request: {},
    reply: outcomes({
        notInstalled: {
            installCost: Num,
            initRange: Num,
        },
        installed: {
            range: Num,
            upgradeCost: Num,
            fuelPerHop: Num,
        },
        error: {
            message: Str,
        },
    }),
});

export const BwarpInstall = defineCommand('bwarpInstall', {
    request: {},
    reply: outcomes({
        ok: {
            range: Num,
            credits: Num,
        },
        error: {
            message: Str,
        },
    }),
});

export const BwarpUpgrade = defineCommand('bwarpUpgrade', {
    request: {},
    reply: outcomes({
        ok: {
            range: Num,
            cost: Num,
            credits: Num,
            treasury: Num,
        },
        error: {
            message: Str,
        },
    }),
});

export const BwarpBeam = defineCommand('bwarpBeam', {
    request: {
        targetSector: Int,
        commit: z.boolean(),
    },
    reply: outcomes({
        distance: {
            targetSector: Int,
            hops: Int,
            range: Num,
            fuelCost: Num,
            planetFuel: Num,
        },
        beamed: {
            targetSector: Int,
            hops: Int,
            fuelUsed: Num,
            turnsUsed: Num,
        },
        error: {
            message: Str,
        },
    }),
});
