// Planetary defense bastions: construction, treasury and the bwarp transporter.

import { z } from 'zod';

import { defineCommand, outcomes } from './define.js';

import { Int, Num, Str, PositiveInt, SectorNumber } from './common.js';

export const BaseInfo = defineCommand('baseInfo', {
    request: {},
    reply: outcomes({
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
    }),
});

export const TreasuryTransfer = defineCommand('treasuryTransfer', {
    request: {
        direction: z.enum(['to', 'from']),
        amount: PositiveInt,
    },
    reply: outcomes({
        ok: {
            direction: z.enum(['to', 'from']),
            amount: Num,
            credits: Num,
            treasury: Num,
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
    }),
});

export const BwarpInstall = defineCommand('bwarpInstall', {
    request: {},
    reply: outcomes({
        ok: {
            range: Num,
            credits: Num,
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
    }),
});

export const BwarpBeam = defineCommand('bwarpBeam', {
    request: {
        targetSector: SectorNumber,
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
    }),
});
