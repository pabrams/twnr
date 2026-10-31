// Connection lifecycle and transport-level pushes.

import { z } from 'zod';
import { Menu, type MenuName } from '../tags.js';

import { defineEvent } from './define.js';

import { Int, Num, Bool, Str, IntOrNull, StrOrNull, HardwareMap } from './common.js';

export const MenuNameSchema = z.enum(Object.values(Menu) as [MenuName, ...MenuName[]]);

export const Welcome = defineEvent('welcome', {
    playerId: Int,
    name: Str,
    sector: Int,
    token: Str,
    totalSectors: Int,
    shipTypeName: StrOrNull,
    coloredShipName: StrOrNull,
    starbaseSector: IntOrNull,
    location: MenuNameSchema,
    isGuest: Bool,
    isAdmin: Bool,
    clanId: IntOrNull,
});

export const RateLimited = defineEvent('rateLimited', {});

export const ProtocolError = defineEvent('error', {
    message: Str,
});

export const StatsSnapshot = defineEvent('statsSnapshot', {
    sector: Int,
    turns: Num,
    experience: Num,
    alignment: Num,
    credits: Num,
    shipTypeName: Str,
    shipTypeDisplayName: StrOrNull,
    holds: z.object({
        fuel: Num,
        organics: Num,
        equipment: Num,
        colonists: Num,
        empty: Num,
        total: Num,
    }),
    ship: z.object({
        drones: Num,
        shields: Num,
        maxDroneAttack: Num,
    }),
    hardware: HardwareMap,
});
