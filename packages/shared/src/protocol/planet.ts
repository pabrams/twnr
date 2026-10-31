// Planets: landing, colonists, cargo, terraforming, claiming and destruction.

import { z } from 'zod';

import { defineCommand, defineEvent, outcomes } from './define.js';

import {
    Commodity3,
    Ownership,
    Int,
    Num,
    Bool,
    Str,
    NumOrNull,
    IntOrNull,
    StrOrNull,
    DateString,
    SectorDisplayDataSchema,
} from './common.js';

export const Commodity4 = z.enum(['fuel', 'organics', 'equipment', 'drones']);

export const PlanetDisplayDataSchema = z.object({
    id: Int,
    universe_planet_number: Int,
    sector_id: Int,
    name: Str,
    planetType: Str,
    displayType: StrOrNull,
    owner_name: StrOrNull,
    drones: Num,
    fuel: Num,
    organics: Num,
    equipment: Num,
    colonists_fuel: Num,
    colonists_organics: Num,
    colonists_equipment: Num,
    empty_holds: Num,
    ship_colonists: Num,
    ship_drones: Num,
    ship_max_drones: Num,
    ship_fuel: Num,
    ship_organics: Num,
    ship_equipment: Num,
    fuel_production: Num,
    organics_production: Num,
    equipment_production: Num,
    fig_factor_fuel: Num,
    fig_factor_org: Num,
    fig_factor_equ: Num,
    max_fuel: Num,
    max_org: Num,
    max_equ: Num,
    max_drones: Num,
    max_fuel_colos: Num,
    max_org_colos: Num,
    max_equ_colos: Num,
    colos_per_unit_per_hour: Num,
    base_level: IntOrNull,
    base_treasury: NumOrNull,
    base_transporter_range: NumOrNull,
    base_construction_target_level: IntOrNull,
    base_construction_completes_at: DateString.nullable(),
    created_at: DateString,
    updated_at: DateString.nullable().optional(),
});

export type PlanetDisplayData = z.infer<typeof PlanetDisplayDataSchema>;

export const SectorDisplayPartial = SectorDisplayDataSchema.partial();

/** Sent to everyone affected by a planet's destruction; `wasOnPlanet` recipients have been lifted back to their ship. */
export const PlanetDestroyedAlert = defineEvent('planetDestroyedAlert', {
    planetName: Str,
    sector: Int,
    cause: z.enum(['buster', 'collision']),
    wasOnPlanet: Bool,
});

export const GetSectorPlanets = defineCommand('getSectorPlanets', {
    request: {},
    reply: {
        planets: z.array(
            z.object({
                id: Int,
                registryNumber: Int,
                name: Str,
                type: Str,
                displayType: StrOrNull,
            }),
        ),
    },
});

export const LandOnPlanet = defineCommand('landOnPlanet', {
    request: {
        planetId: Int,
    },
    reply: PlanetDisplayDataSchema,
});

export const PlanetDisplay = defineCommand('planetDisplay', {
    request: {},
    reply: PlanetDisplayDataSchema,
});

export const LeavePlanet = defineCommand('leavePlanet', {
    request: {},
    reply: {
        turnsUsed: Num.optional(),
    },
});

export const DestroyPlanet = defineCommand('destroyPlanet', {
    request: {},
    reply: {
        destroyed: Bool,
        planetId: Int,
        planetName: Str,
        expDelta: Num.optional(),
        repDelta: Num.optional(),
    },
});

export const TerraformInfo = defineCommand('terraformInfo', {
    request: {},
    reply: {
        canTerraform: Bool,
        devices: Num,
        reason: z.enum(['restricted_sector', 'no_devices']).optional(),
    },
});

export const UseTerraformDevice = defineCommand('useTerraformDevice', {
    request: {},
    reply: {
        success: Bool,
        reason: Str.optional(),
        planet: z
            .object({
                id: Int,
                name: Str,
                type: Str,
                displayType: StrOrNull,
                sectorId: Int,
            })
            .optional(),
        collision: Bool.optional(),
        terraformDevices: Num.optional(),
        expDelta: Num.optional(),
        repDelta: Num.optional(),
    },
});

export const SetTerraformedPlanet = defineCommand('setTerraformedPlanet', {
    request: {
        planetId: Int,
        name: z.string(),
        ownership: z.enum(['personal', 'clan']),
    },
    reply: outcomes({
        success: {
            planetId: Int,
            name: Str,
            ownership: z.enum(['personal', 'clan']),
        },
        error: {
            message: Str,
        },
    }),
});

export const TakeColonists = defineCommand('takeColonists', {
    request: {
        quantity: Int,
        commodity: Commodity3,
    },
    reply: SectorDisplayPartial.extend({
        quantity: Num,
        commodity: Commodity3,
        planetColonists: Num,
        shipColonists: Num,
    }),
});

export const LeaveColonists = defineCommand('leaveColonists', {
    request: {
        quantity: Int,
        commodity: Commodity3,
    },
    reply: SectorDisplayPartial.extend({
        quantity: Num,
        commodity: Commodity3,
        planetColonists: Num,
        shipColonists: Num,
    }),
});

export const TakeCommodity = defineCommand('takeCommodity', {
    request: {
        quantity: Int,
        commodity: Commodity4,
    },
    reply: {
        quantity: Num,
        commodity: Commodity4,
        planetCommodity: Num,
        shipCommodity: Num,
    },
});

export const LeaveCommodity = defineCommand('leaveCommodity', {
    request: {
        quantity: Int,
        commodity: Commodity4,
    },
    reply: {
        quantity: Num,
        commodity: Commodity4,
        planetCommodity: Num,
        shipCommodity: Num,
    },
});

export const ChangePopulation = defineCommand('changePopulation', {
    request: {
        quantity: Int,
        from: Commodity3,
        to: Commodity3,
    },
    reply: {
        quantity: Num,
        from: Commodity3,
        to: Commodity3,
        fromCount: Num,
        toCount: Num,
    },
});

export const ListPlanets = defineCommand('listPlanets', {
    request: {},
    reply: {
        planets: z.array(
            z.object({
                id: Int,
                sectorNumber: Int,
                name: Str,
                type: Str,
                displayType: StrOrNull,
                drones: Num,
                fuel: Num,
                organics: Num,
                equipment: Num,
                colonists_fuel: Num,
                colonists_organics: Num,
                colonists_equipment: Num,
            }),
        ),
    },
});

export const ClaimPlanet = defineCommand('claimPlanet', {
    request: {
        ownership: Ownership,
    },
    reply: {
        planetId: Int,
        planetName: Str,
        ownership: Ownership,
    },
});
