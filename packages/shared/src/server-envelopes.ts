// WebSocket messages (server → client). Each export pairs a zod schema with
// the inferred TypeScript type; existing consumers can keep importing the
// type name unchanged.

import { z } from 'zod';
import { ServerTag } from './tags.js';

// Menu name set — duplicated as a zod schema here so the envelope can be
// validated standalone. Kept in sync with the Menu const in ./tags.ts.
const MenuNameSchema = z.enum([
    'sector',
    'port',
    'class0',
    'attack',
    'computer',
    'autopilotPrompt',
    'autopilot',
    'planet',
    'droneEncounter',
    'starbase',
    'starbaseHardware',
    'planetEarth',
    'shipyards',
    'shipyardsClass0',
    'clan',
    'base',
    'baseComputer',
]);

const Commodity3 = z.enum(['fuel', 'organics', 'equipment']);
const Commodity4 = z.enum(['fuel', 'organics', 'equipment', 'drones']);
const Ownership = z.enum(['personal', 'clan']);
const MineTypeSchema = z.enum(['proximity', 'seeker']);
const Int = z.number().int();
const Num = z.number();
const Bool = z.boolean();
const Str = z.string();
const NumOrNull = Num.nullable();
const IntOrNull = Int.nullable();
const StrOrNull = Str.nullable();
const HardwareMap = z.record(Str, Num);
const DateString = z.string();

const CargoSchema = z.object({
    fuel: Num,
    organics: Num,
    equipment: Num,
    colonists: Num,
});

const ShipInfoEmbedSchema = z.object({
    shipName: Str,
    drones: Num,
    maxDrones: Num,
    shields: Num,
    maxShields: Num,
    holds: Num,
    maxHolds: Num,
});

export const SectorRefSchema = z.object({
    sector: Int,
    visited: Bool,
});
export type SectorRef = z.infer<typeof SectorRefSchema>;

export const OwnershipInfoSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('player'),
        name: Str,
        playerId: Int,
        ownerClanNumber: IntOrNull,
    }),
    z.object({
        kind: z.literal('clan'),
        name: Str,
        clanNumber: Int,
        clanId: Int,
    }),
    z.object({ kind: z.literal('rogue') }),
]);
export type OwnershipInfo = z.infer<typeof OwnershipInfoSchema>;

export const SectorDroneInfoSchema = z.object({
    quantity: Num,
    ownerId: IntOrNull,
    ownership: OwnershipInfoSchema,
});
export type SectorDroneInfo = z.infer<typeof SectorDroneInfoSchema>;

export const CollisionInfoSchema = z.object({
    planetName: Str,
    collidingWithName: Str,
    collisionAt: Str,
});
export type CollisionInfo = z.infer<typeof CollisionInfoSchema>;

export const SectorMineEntrySchema = z.object({
    mineType: MineTypeSchema,
    quantity: Num,
    own: Bool,
    ownership: OwnershipInfoSchema,
});
export type SectorMineEntry = z.infer<typeof SectorMineEntrySchema>;

export const SectorBeaconInfoSchema = z.object({
    message: Str,
    ownership: OwnershipInfoSchema,
});
export type SectorBeaconInfo = z.infer<typeof SectorBeaconInfoSchema>;

export const SectorDisplayDataSchema = z.object({
    sector: Int,
    players: z.array(
        z.object({
            id: Int,
            name: Str,
            clanNumber: IntOrNull,
            shipName: Str,
            shipTypeName: Str,
            shipTypeDisplayName: StrOrNull,
            drones: Num,
        }),
    ),
    warps: z.array(SectorRefSchema),
    port: z.object({ class: Int, name: Str }).nullable().optional(),
    portConstruction: z.object({ class: Int, name: Str, daysLeft: Num }).nullable().optional(),
    sectorDrones: SectorDroneInfoSchema.nullable().optional(),
    planets: z.array(z.object({ id: Int, name: Str, type: Str, displayType: StrOrNull })),
    ships: z
        .array(
            z.object({
                id: Int,
                name: Str,
                typeName: Str,
                typeDisplayName: StrOrNull,
                drones: Num,
                ownership: OwnershipInfoSchema,
            }),
        )
        .optional(),
    collisions: z.array(CollisionInfoSchema).optional(),
    sectorMines: z.array(SectorMineEntrySchema).optional(),
    beacon: SectorBeaconInfoSchema.nullable().optional(),
});
export type SectorDisplayData = z.infer<typeof SectorDisplayDataSchema>;

export const TowedAlongSchema = z.object({
    kind: z.enum(['manned', 'unmanned']),
    name: Str,
    shipTypeDisplayName: StrOrNull,
    shipTypeName: Str,
});
export type TowedAlong = z.infer<typeof TowedAlongSchema>;

export const WelcomeEventSchema = z.object({
    type: z.literal(ServerTag.Welcome),
    playerId: Int,
    name: Str,
    sector: Int,
    token: Str,
    totalSectors: Int,
    shipName: Str,
    coloredShipName: StrOrNull,
    startingShip: z
        .object({
            typeName: Str,
            typeDisplayName: StrOrNull,
        })
        .optional(),
    starbaseSector: IntOrNull,
    location: MenuNameSchema,
    isGuest: Bool,
    isAdmin: Bool,
    clanId: IntOrNull,
});
export type WelcomeEvent = z.infer<typeof WelcomeEventSchema>;

export const PlayerMovedEventSchema = z.object({
    type: z.literal(ServerTag.PlayerMoved),
    playerId: Int,
    playerName: Str,
    sector: Int,
    direction: z.enum(['in', 'out']),
    towedAlong: TowedAlongSchema.optional(),
});
export type PlayerMovedEvent = z.infer<typeof PlayerMovedEventSchema>;

export const SectorDisplayReplySchema = SectorDisplayDataSchema.extend({
    type: z.literal(ServerTag.SectorDisplayResult),
});
export type SectorDisplayReply = z.infer<typeof SectorDisplayReplySchema>;

const MoveResultLit = z.literal(ServerTag.MoveResult);

export const MoveReplySchema = z.discriminatedUnion('outcome', [
    SectorDisplayDataSchema.extend({
        type: MoveResultLit,
        outcome: z.literal('success'),
        turnsUsed: Num.optional(),
        towedAlong: TowedAlongSchema.optional(),
        freedFromTow: z.literal(true).optional(),
    }),
    SectorDisplayDataSchema.extend({
        type: MoveResultLit,
        outcome: z.literal('encounter'),
        ownerId: IntOrNull,
        ownerName: Str,
        shipDrones: Num,
        retreatSector: Int,
        turnsUsed: Num.optional(),
        towedAlong: TowedAlongSchema.optional(),
        freedFromTow: z.literal(true).optional(),
    }),
    z.object({
        type: MoveResultLit,
        outcome: z.literal('nonAdjacent'),
        sector: Int,
    }),
    z.object({ type: MoveResultLit, outcome: z.literal('noShip') }),
    z.object({
        type: MoveResultLit,
        outcome: z.literal('destroyed'),
        reason: Str,
    }),
    z.object({
        type: MoveResultLit,
        outcome: z.literal('error'),
        message: Str,
    }),
]);
export type MoveReply = z.infer<typeof MoveReplySchema>;

export const PlayerLeftEventSchema = z.object({
    type: z.literal(ServerTag.PlayerLeft),
    playerId: Int,
});
export type PlayerLeftEvent = z.infer<typeof PlayerLeftEventSchema>;

export const PlayersOnlineReplySchema = z.object({
    type: z.literal(ServerTag.PlayersOnlineResult),
    players: z.array(z.object({ id: Int, name: Str })),
});
export type PlayersOnlineReply = z.infer<typeof PlayersOnlineReplySchema>;

export const NoShipReplySchema = z.object({
    type: z.literal(ServerTag.NoShip),
});
export type NoShipReply = z.infer<typeof NoShipReplySchema>;

export const NonAdjacentMoveReplySchema = z.object({
    type: z.literal(ServerTag.NonAdjacentMoveRequested),
    playerId: Int,
    sector: Int,
});
export type NonAdjacentMoveReply = z.infer<typeof NonAdjacentMoveReplySchema>;

export const RateLimitedEventSchema = z.object({
    type: z.literal(ServerTag.RateLimited),
});
export type RateLimitedEvent = z.infer<typeof RateLimitedEventSchema>;

export const WarpsOutReplySchema = z.object({
    type: z.literal(ServerTag.WarpsOutResult),
    id: Int,
    warps: z.array(SectorRefSchema),
});
export type WarpsOutReply = z.infer<typeof WarpsOutReplySchema>;

export const ShortestPathReplySchema = z.object({
    type: z.literal(ServerTag.ShortestPathResult),
    path: z.array(SectorRefSchema),
    hops: Int,
    turns: Num,
});
export type ShortestPathReply = z.infer<typeof ShortestPathReplySchema>;

export const PortInfoReplySchema = z.object({
    type: z.literal(ServerTag.PortInfoResult),
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
export type PortInfoReply = z.infer<typeof PortInfoReplySchema>;

export const ShipInfoReplySchema = z.object({
    type: z.literal(ServerTag.ShipInfoResult),
    playerId: Int,
    shipName: Str,
    coloredShipName: StrOrNull,
    drones: Num,
    shields: Num,
    maxDrones: Num,
    maxShields: Num,
    cargoLimit: Num,
    maxHolds: Num,
    cargoFuel: Num,
    cargoOrganics: Num,
    cargoEquipment: Num,
    cargoColonists: Num,
    holdsAvailable: Num,
    hardware: HardwareMap,
    hardwareMax: HardwareMap,
    turnsPerWarp: Num,
    hasHyperwarpDrive: Bool,
    turns: Num,
    credits: Num,
    clanNumber: IntOrNull,
    clanName: StrOrNull,
});
export type ShipInfoReply = z.infer<typeof ShipInfoReplySchema>;

export const PortTransactionReplySchema = z.object({
    type: z.literal(ServerTag.PortTransactionResult),
    credits: Num,
    cargo: CargoSchema,
    emptyHolds: Num,
    turnsUsed: Num.optional(),
});
export type PortTransactionReply = z.infer<typeof PortTransactionReplySchema>;

export const BuyDronesReplySchema = z.object({
    type: z.literal(ServerTag.BuyDronesResult),
    credits: Num,
    drones: Num,
});
export type BuyDronesReply = z.infer<typeof BuyDronesReplySchema>;

export const BuyShieldsReplySchema = z.object({
    type: z.literal(ServerTag.BuyShieldsResult),
    credits: Num,
    shields: Num,
});
export type BuyShieldsReply = z.infer<typeof BuyShieldsReplySchema>;

export const BuyHoldsReplySchema = z.object({
    type: z.literal(ServerTag.BuyHoldsResult),
    credits: Num,
    cargoLimit: Num,
    turnsUsed: Num.optional(),
});
export type BuyHoldsReply = z.infer<typeof BuyHoldsReplySchema>;

export const BuyShipTradeinReplySchema = z.object({
    type: z.literal(ServerTag.BuyShipTradeinResult),
    shipName: Str,
    coloredShipName: StrOrNull,
    credits: Num,
    maxDrones: Num,
    maxShields: Num,
    cargoLimit: Num,
});
export type BuyShipTradeinReply = z.infer<typeof BuyShipTradeinReplySchema>;

export const AttackShipReplySchema = z.object({
    type: z.literal(ServerTag.AttackShipResult),
    destroyed: Bool,
    attackerDronesLost: Num,
    defenderShieldsLost: Num,
    defenderDronesLost: Num,
    message: Str.optional(),
});
export type AttackShipReply = z.infer<typeof AttackShipReplySchema>;

export const DockReplySchema = z.object({
    type: z.literal(ServerTag.DockResult),
    docked: Bool,
    port: PortInfoReplySchema.optional(),
    credits: Num.optional(),
    cargo: CargoSchema.optional(),
    emptyHolds: Num.optional(),
    freedFromTow: z.literal(true).optional(),
    shipInfo: ShipInfoEmbedSchema.optional(),
});
export type DockReply = z.infer<typeof DockReplySchema>;

export const PlanetInfoReplySchema = z.object({
    type: z.literal(ServerTag.PlanetInfoResult),
    sectorId: Int,
    name: Str,
    planetType: Str,
    displayType: StrOrNull,
    colonists: Num,
    hasPlanet: Bool,
});
export type PlanetInfoReply = z.infer<typeof PlanetInfoReplySchema>;

export const UseTerraformDeviceReplySchema = z.object({
    type: z.literal(ServerTag.UseTerraformDeviceResult),
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
});
export type UseTerraformDeviceReply = z.infer<typeof UseTerraformDeviceReplySchema>;

export const GetSectorPlanetsReplySchema = z.object({
    type: z.literal(ServerTag.GetSectorPlanetsResult),
    planets: z.array(z.object({ id: Int, name: Str, type: Str, displayType: StrOrNull })),
});
export type GetSectorPlanetsReply = z.infer<typeof GetSectorPlanetsReplySchema>;

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

export const LandOnPlanetReplySchema = PlanetDisplayDataSchema.extend({
    type: z.literal(ServerTag.LandOnPlanetResult),
});
export type LandOnPlanetReply = z.infer<typeof LandOnPlanetReplySchema>;

export const PlanetDisplayReplySchema = PlanetDisplayDataSchema.extend({
    type: z.literal(ServerTag.PlanetDisplayResult),
});
export type PlanetDisplayReply = z.infer<typeof PlanetDisplayReplySchema>;

export const DestroyPlanetReplySchema = z.object({
    type: z.literal(ServerTag.DestroyPlanetResult),
    destroyed: Bool,
    planetId: Int,
    planetName: Str,
});
export type DestroyPlanetReply = z.infer<typeof DestroyPlanetReplySchema>;

export const BuyHardwareReplySchema = z.object({
    type: z.literal(ServerTag.BuyHardwareResult),
    itemName: Str,
    label: Str,
    kind: z.enum(['stackable', 'toggle']),
    quantity: Num.optional(),
    totalOnShip: Num.optional(),
    credits: Num,
    cost: Num,
});
export type BuyHardwareReply = z.infer<typeof BuyHardwareReplySchema>;

export const HardwarePriceItemSchema = z.object({
    name: Str,
    label: Str,
    price: Num,
});
export type HardwarePriceItem = z.infer<typeof HardwarePriceItemSchema>;

export const DockStarbaseReplySchema = z.object({
    type: z.literal(ServerTag.DockStarbaseResult),
    prices: z.array(HardwarePriceItemSchema),
    credits: Num.optional(),
    shipInfo: ShipInfoEmbedSchema.optional(),
});
export type DockStarbaseReply = z.infer<typeof DockStarbaseReplySchema>;

// SectorDisplayData fields are tacked on via Partial — present on .planet
// returns, absent on standalone returns from a non-sector context. Use
// .partial() then spread into the reply.
const SectorDisplayPartial = SectorDisplayDataSchema.partial();

export const TakeColonistsReplySchema = SectorDisplayPartial.extend({
    type: z.literal(ServerTag.TakeColonistsResult),
    quantity: Num,
    commodity: Commodity3,
    planetColonists: Num,
    shipColonists: Num,
});
export type TakeColonistsReply = z.infer<typeof TakeColonistsReplySchema>;

export const LeaveColonistsReplySchema = SectorDisplayPartial.extend({
    type: z.literal(ServerTag.LeaveColonistsResult),
    quantity: Num,
    commodity: Commodity3,
    planetColonists: Num,
    shipColonists: Num,
});
export type LeaveColonistsReply = z.infer<typeof LeaveColonistsReplySchema>;

export const TakeCommodityReplySchema = z.object({
    type: z.literal(ServerTag.TakeCommodityResult),
    quantity: Num,
    commodity: Commodity4,
    planetCommodity: Num,
    shipCommodity: Num,
});
export type TakeCommodityReply = z.infer<typeof TakeCommodityReplySchema>;

export const LeaveCommodityReplySchema = z.object({
    type: z.literal(ServerTag.LeaveCommodityResult),
    quantity: Num,
    commodity: Commodity4,
    planetCommodity: Num,
    shipCommodity: Num,
});
export type LeaveCommodityReply = z.infer<typeof LeaveCommodityReplySchema>;

export const ChangePopulationReplySchema = z.object({
    type: z.literal(ServerTag.ChangePopulationResult),
    quantity: Num,
    from: Commodity3,
    to: Commodity3,
    fromCount: Num,
    toCount: Num,
});
export type ChangePopulationReply = z.infer<typeof ChangePopulationReplySchema>;

export const DeployDronesInfoReplySchema = z.object({
    type: z.literal(ServerTag.DeployDronesInfoResult),
    sectorDrones: Num,
    shipDrones: Num,
    shipMaxDrones: Num,
});
export type DeployDronesInfoReply = z.infer<typeof DeployDronesInfoReplySchema>;

export const DeployDronesReplySchema = z.object({
    type: z.literal(ServerTag.DeployDronesResult),
    sectorDrones: Num,
    shipDrones: Num,
});
export type DeployDronesReply = z.infer<typeof DeployDronesReplySchema>;

export const AttackSectorDronesReplySchema = z.object({
    type: z.literal(ServerTag.AttackSectorDronesResult),
    victory: Bool,
    dronesLost: Num,
    sectorDronesRemaining: Num,
    shipDrones: Num,
});
export type AttackSectorDronesReply = z.infer<typeof AttackSectorDronesReplySchema>;

export const RetreatFromDronesReplySchema = z.object({
    type: z.literal(ServerTag.RetreatFromDronesResult),
    sector: Int,
});
export type RetreatFromDronesReply = z.infer<typeof RetreatFromDronesReplySchema>;

export const SectorDronesAlertEventSchema = z.object({
    type: z.literal(ServerTag.SectorDronesAlert),
    event: z.enum(['intrusion', 'attacked', 'destroyed']),
    sector: Int,
    dronesLost: Num,
    dronesRemaining: Num,
    intruderName: Str,
});
export type SectorDronesAlertEvent = z.infer<typeof SectorDronesAlertEventSchema>;

const JettisonLit = z.literal(ServerTag.JettisonResult);
export const JettisonReplySchema = z.discriminatedUnion('outcome', [
    z.object({
        type: JettisonLit,
        outcome: z.literal('success'),
        jettisoned: CargoSchema,
    }),
    z.object({
        type: JettisonLit,
        outcome: z.literal('error'),
        message: Str,
    }),
]);
export type JettisonReply = z.infer<typeof JettisonReplySchema>;

const UndockLit = z.literal(ServerTag.UndockResult);
export const UndockReplySchema = z.discriminatedUnion('outcome', [
    SectorDisplayDataSchema.extend({
        type: UndockLit,
        outcome: z.literal('success'),
    }),
    z.object({
        type: UndockLit,
        outcome: z.literal('error'),
        message: Str,
    }),
]);
export type UndockReply = z.infer<typeof UndockReplySchema>;

export const LeavePlanetReplySchema = z.object({
    type: z.literal(ServerTag.LeavePlanetResult),
    turnsUsed: Num.optional(),
});
export type LeavePlanetReply = z.infer<typeof LeavePlanetReplySchema>;

export const LeaveStarbaseReplySchema = SectorDisplayDataSchema.extend({
    type: z.literal(ServerTag.LeaveStarbaseResult),
});
export type LeaveStarbaseReply = z.infer<typeof LeaveStarbaseReplySchema>;

export const BuyShipNewReplySchema = z.object({
    type: z.literal(ServerTag.BuyShipNewResult),
    shipName: Str,
    coloredShipName: StrOrNull,
    credits: Num,
    maxDrones: Num,
    maxShields: Num,
    cargoLimit: Num,
});
export type BuyShipNewReply = z.infer<typeof BuyShipNewReplySchema>;

export const ListDeployedDronesReplySchema = z.object({
    type: z.literal(ServerTag.ListDeployedDronesResult),
    drones: z.array(
        z.object({
            sectorId: Int,
            quantity: Num,
            ownerLabel: Str,
            ownership: OwnershipInfoSchema,
        }),
    ),
});
export type ListDeployedDronesReply = z.infer<typeof ListDeployedDronesReplySchema>;

export const HyperspaceJumpReplySchema = z.object({
    type: z.literal(ServerTag.HyperspaceJumpResult),
    targetSector: Int,
    fuelUsed: Num,
    turnsUsed: Num,
});
export type HyperspaceJumpReply = z.infer<typeof HyperspaceJumpReplySchema>;

export const ErrorReplySchema = z.object({
    type: z.literal(ServerTag.Error),
    message: Str,
});
export type ErrorReply = z.infer<typeof ErrorReplySchema>;

export const VisitedSectorsReplySchema = z.object({
    type: z.literal(ServerTag.VisitedSectorsResult),
    sectors: z.array(Int),
    totalSectors: Int,
});
export type VisitedSectorsReply = z.infer<typeof VisitedSectorsReplySchema>;

export const ListPlanetsReplySchema = z.object({
    type: z.literal(ServerTag.ListPlanetsResult),
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
});
export type ListPlanetsReply = z.infer<typeof ListPlanetsReplySchema>;

export const PreviousSectorReplySchema = z.object({
    type: z.literal(ServerTag.PreviousSectorResult),
    sector: IntOrNull,
});
export type PreviousSectorReply = z.infer<typeof PreviousSectorReplySchema>;

export const ShipDetailReplySchema = z.object({
    type: z.literal(ServerTag.ShipDetailResult),
    shipId: Int,
    shipNumber: Int,
    typeName: Str,
    typeDisplayName: StrOrNull,
    sector: IntOrNull,
    drones: Num,
    maxDrones: Num,
    shields: Num,
    maxShields: Num,
    holds: Num,
    maxHolds: Num,
    transporterRange: Num,
    cargoFuel: Num,
    cargoOrganics: Num,
    cargoEquipment: Num,
    cargoColonists: Num,
    ownership: OwnershipInfoSchema,
    hardware: HardwareMap,
    hardwareMax: HardwareMap,
});
export type ShipDetailReply = z.infer<typeof ShipDetailReplySchema>;

export const TransportToShipReplySchema = z.object({
    type: z.literal(ServerTag.TransportToShipResult),
    targetShipId: Int,
    targetSector: Int,
    turnsUsed: Num,
    turnsRemaining: Num,
});
export type TransportToShipReply = z.infer<typeof TransportToShipReplySchema>;

export const ClanCreateReplySchema = z.object({
    type: z.literal(ServerTag.ClanCreateResult),
    clanId: Int,
    clanNumber: Int,
    name: Str,
});
export type ClanCreateReply = z.infer<typeof ClanCreateReplySchema>;

export const ClanJoinReplySchema = z.object({
    type: z.literal(ServerTag.ClanJoinResult),
    clanId: Int,
    clanNumber: Int,
    name: Str,
});
export type ClanJoinReply = z.infer<typeof ClanJoinReplySchema>;

export const ClanLeaveReplySchema = z.object({
    type: z.literal(ServerTag.ClanLeaveResult),
    outcome: z.enum(['left', 'dissolved']),
    convertedToPersonal: Num,
    convertedToRogue: Num,
});
export type ClanLeaveReply = z.infer<typeof ClanLeaveReplySchema>;

export const ClanListEntrySchema = z.object({
    clanId: Int,
    clanNumber: Int,
    name: Str,
    memberCount: Num,
    leaderName: Str,
    isOwn: Bool,
});
export type ClanListEntry = z.infer<typeof ClanListEntrySchema>;

export const ClanListReplySchema = z.object({
    type: z.literal(ServerTag.ClanListResult),
    viewerClanId: IntOrNull,
    clans: z.array(ClanListEntrySchema),
});
export type ClanListReply = z.infer<typeof ClanListReplySchema>;

export const ClanMemberEntrySchema = z.object({
    playerId: Int,
    name: Str,
    isLeader: Bool,
});
export type ClanMemberEntry = z.infer<typeof ClanMemberEntrySchema>;

export const ChangeShipOwnershipReplySchema = z.object({
    type: z.literal(ServerTag.ChangeShipOwnershipResult),
    shipId: Int,
    ownership: Ownership,
});
export type ChangeShipOwnershipReply = z.infer<typeof ChangeShipOwnershipReplySchema>;

export const ClaimPlanetReplySchema = z.object({
    type: z.literal(ServerTag.ClaimPlanetResult),
    planetId: Int,
    planetName: Str,
    ownership: Ownership,
});
export type ClaimPlanetReply = z.infer<typeof ClaimPlanetReplySchema>;

export const ClanTransferReplySchema = z.object({
    type: z.literal(ServerTag.ClanTransferResult),
    kind: z.enum(['credits', 'drones', 'shields', 'mines']),
    targetPlayerId: Int,
    targetName: Str,
    quantity: Num,
    delivered: Num,
});
export type ClanTransferReply = z.infer<typeof ClanTransferReplySchema>;

export const ClanMemoReplySchema = z.object({
    type: z.literal(ServerTag.ClanMemoResult),
    recipientCount: Num,
});
export type ClanMemoReply = z.infer<typeof ClanMemoReplySchema>;

export const ClanSetPasswordReplySchema = z.object({
    type: z.literal(ServerTag.ClanSetPasswordResult),
});
export type ClanSetPasswordReply = z.infer<typeof ClanSetPasswordReplySchema>;

export const ClanDropMemberReplySchema = z.object({
    type: z.literal(ServerTag.ClanDropMemberResult),
    droppedPlayerId: Int,
    droppedName: Str,
});
export type ClanDropMemberReply = z.infer<typeof ClanDropMemberReplySchema>;

export const ClanMembershipChangedEventSchema = z.object({
    type: z.literal(ServerTag.ClanMembershipChanged),
    clanId: IntOrNull,
    reason: z.enum(['dropped', 'dissolved', 'other']),
});
export type ClanMembershipChangedEvent = z.infer<typeof ClanMembershipChangedEventSchema>;

export const MemoDeliveryEventSchema = z.object({
    type: z.literal(ServerTag.MemoDelivery),
    reason: z.enum(['connect', 'read', 'incoming']),
    memos: z.array(
        z.object({
            id: Int,
            senderName: StrOrNull,
            kind: Str,
            body: Str,
            createdAt: Str,
        }),
    ),
});
export type MemoDeliveryEvent = z.infer<typeof MemoDeliveryEventSchema>;

export const ClanInfoReplySchema = z.object({
    type: z.literal(ServerTag.ClanInfoResult),
    clan: z
        .object({
            clanId: Int,
            clanNumber: Int,
            name: Str,
            leaderPlayerId: Int,
            members: z.array(ClanMemberEntrySchema),
            maxSize: Num,
        })
        .nullable(),
});
export type ClanInfoReply = z.infer<typeof ClanInfoReplySchema>;

export const ListOwnedShipsReplySchema = z.object({
    type: z.literal(ServerTag.ListOwnedShipsResult),
    currentSector: Int,
    currentShipId: IntOrNull,
    currentShipTypeName: StrOrNull,
    currentShipTypeDisplayName: StrOrNull,
    currentShipTransporterRange: NumOrNull,
    viewerClanId: IntOrNull,
    ships: z.array(
        z.object({
            id: Int,
            shipNumber: Int,
            sector: IntOrNull,
            drones: Num,
            shields: Num,
            holds: Num,
            hops: IntOrNull,
            typeName: Str,
            typeDisplayName: StrOrNull,
            transporterRange: Num,
            ownerPlayerId: IntOrNull,
            ownerClanId: IntOrNull,
            ownerLabel: Str,
        }),
    ),
});
export type ListOwnedShipsReply = z.infer<typeof ListOwnedShipsReplySchema>;

export const GetAttackTargetsReplySchema = z.object({
    type: z.literal(ServerTag.GetAttackTargetsResult),
    players: z.array(z.object({ id: Int, name: Str })),
    beaconPresent: Bool,
});
export type GetAttackTargetsReply = z.infer<typeof GetAttackTargetsReplySchema>;

export const ReleaseBeaconReplySchema = z.object({
    type: z.literal(ServerTag.ReleaseBeaconResult),
    outcome: z.enum(['launched', 'collision', 'noBeacons']),
    sector: Int,
    beaconsRemaining: Num,
});
export type ReleaseBeaconReply = z.infer<typeof ReleaseBeaconReplySchema>;

export const AttackBeaconReplySchema = z.object({
    type: z.literal(ServerTag.AttackBeaconResult),
    destroyed: Bool,
    shipDrones: Num,
});
export type AttackBeaconReply = z.infer<typeof AttackBeaconReplySchema>;

export const DensityScanEntrySchema = z.object({
    sector: Int,
    visited: Bool,
    density: Num,
    warps: Num,
    navHaz: Num,
    anom: Bool,
});
export type DensityScanEntry = z.infer<typeof DensityScanEntrySchema>;

export const DensityScanReplySchema = z.object({
    type: z.literal(ServerTag.DensityScanResult),
    entries: z.array(DensityScanEntrySchema),
    hasVisualScanner: Bool,
});
export type DensityScanReply = z.infer<typeof DensityScanReplySchema>;

export const VisualScanReplySchema = z.object({
    type: z.literal(ServerTag.VisualScanResult),
    sectors: z.array(SectorDisplayDataSchema),
});
export type VisualScanReply = z.infer<typeof VisualScanReplySchema>;

export const StarbaseInfoReplySchema = z.object({
    type: z.literal(ServerTag.StarbaseInfoResult),
    sector: IntOrNull,
    universeName: Str,
    sectorCount: Int,
    portCount: Int,
    createdAt: Str,
    daysElapsed: Num,
    outWarpDistribution: z.array(Num),
    maxPlanetsPerSector: Int,
    startingCredits: Num,
    startingTurns: Num,
    startingDrones: Num,
    startingHolds: Num,
    respawnDelaySeconds: Num,
});
export type StarbaseInfoReply = z.infer<typeof StarbaseInfoReplySchema>;

export const TerraformInfoReplySchema = z.object({
    type: z.literal(ServerTag.TerraformInfoResult),
    canTerraform: Bool,
    devices: Num,
    reason: z.enum(['restricted_sector', 'no_devices']).optional(),
});
export type TerraformInfoReply = z.infer<typeof TerraformInfoReplySchema>;

export const HardwareStoreItemSchema = z.object({
    name: Str,
    label: Str,
    kind: z.enum(['stackable', 'toggle']),
    price: Num,
    currentQty: Num,
    maxQty: Num,
});
export type HardwareStoreItem = z.infer<typeof HardwareStoreItemSchema>;

export const HardwareStoreInfoReplySchema = z.object({
    type: z.literal(ServerTag.HardwareStoreInfoResult),
    credits: Num,
    items: z.array(HardwareStoreItemSchema),
});
export type HardwareStoreInfoReply = z.infer<typeof HardwareStoreInfoReplySchema>;

export const NeighborhoodSectorSchema = z.object({
    id: Int,
    sector_number: Int,
    x: NumOrNull,
    y: NumOrNull,
    visibility: z.enum(['visited', 'glimpsed']),
    fringe: Bool,
    port: z.object({ class: Int, observed_at: Str }).nullable(),
    planets: z.array(z.object({ name: Str, type: StrOrNull, observed_at: Str })),
});
export type NeighborhoodSector = z.infer<typeof NeighborhoodSectorSchema>;

export const NeighborhoodWarpSchema = z.object({
    from_sector_id: Int,
    to_sector_id: Int,
    known_two_way: Bool,
});
export type NeighborhoodWarp = z.infer<typeof NeighborhoodWarpSchema>;

export const DeployMineInfoReplySchema = z.object({
    type: z.literal(ServerTag.DeployMineInfoResult),
    mineType: MineTypeSchema,
    sectorMines: Num,
    shipMines: Num,
    shipMaxMines: Num,
});
export type DeployMineInfoReply = z.infer<typeof DeployMineInfoReplySchema>;

export const DeployMineReplySchema = z.object({
    type: z.literal(ServerTag.DeployMineResult),
    mineType: MineTypeSchema,
    sectorMines: Num,
    shipMines: Num,
});
export type DeployMineReply = z.infer<typeof DeployMineReplySchema>;

export const DeployedMineEntrySchema = z.object({
    sectorNumber: Int,
    mineType: MineTypeSchema,
    quantity: Num,
    ownerLabel: Str,
    ownership: OwnershipInfoSchema,
});
export type DeployedMineEntry = z.infer<typeof DeployedMineEntrySchema>;

export const ListDeployedMinesReplySchema = z.object({
    type: z.literal(ServerTag.ListDeployedMinesResult),
    mines: z.array(DeployedMineEntrySchema),
});
export type ListDeployedMinesReply = z.infer<typeof ListDeployedMinesReplySchema>;

export const TrackedSeekerMineEntrySchema = z.object({
    targetShipId: Int,
    targetShipName: Str,
    targetOwnerName: Str,
    sectorNumber: Int,
});
export type TrackedSeekerMineEntry = z.infer<typeof TrackedSeekerMineEntrySchema>;

export const TrackSeekerMinesReplySchema = z.object({
    type: z.literal(ServerTag.TrackSeekerMinesResult),
    targets: z.array(TrackedSeekerMineEntrySchema),
});
export type TrackSeekerMinesReply = z.infer<typeof TrackSeekerMinesReplySchema>;

export const MineDisruptorReplySchema = z.object({
    type: z.literal(ServerTag.MineDisruptorResult),
    targetSector: Int,
    minesDisrupted: Num,
    proximityMinesRemaining: Num,
});
export type MineDisruptorReply = z.infer<typeof MineDisruptorReplySchema>;

export const ProximityMineHitEventSchema = z.object({
    type: z.literal(ServerTag.ProximityMineHit),
    sector: Int,
    detonations: Num,
    damage: Num,
    shieldsLost: Num,
    dronesLost: Num,
    destroyed: Bool,
});
export type ProximityMineHitEvent = z.infer<typeof ProximityMineHitEventSchema>;

export const SeekerMineAttachedEventSchema = z.object({
    type: z.literal(ServerTag.SeekerMineAttached),
    sector: Int,
    droppedPrevious: Bool,
});
export type SeekerMineAttachedEvent = z.infer<typeof SeekerMineAttachedEventSchema>;

export const SeekerMinePickupAlertEventSchema = z.object({
    type: z.literal(ServerTag.SeekerMinePickupAlert),
    sector: Int,
    targetShipName: Str,
    targetOwnerName: Str,
});
export type SeekerMinePickupAlertEvent = z.infer<typeof SeekerMinePickupAlertEventSchema>;

export const NeighborhoodReplySchema = z.object({
    type: z.literal(ServerTag.NeighborhoodResult),
    topology: z.enum(['random', 'proximal']),
    current_sector_id: Int,
    sectors: z.array(NeighborhoodSectorSchema),
    warps: z.array(NeighborhoodWarpSchema),
});
export type NeighborhoodReply = z.infer<typeof NeighborhoodReplySchema>;

export const ShipNameRequiredEventSchema = z.object({
    type: z.literal(ServerTag.ShipNameRequired),
    reason: z.enum(['initial', 'respawn', 'buyNew', 'tradein']),
    shipTypeDisplayName: Str,
    shipTypeName: Str,
});
export type ShipNameRequiredEvent = z.infer<typeof ShipNameRequiredEventSchema>;

export const SetShipNameReplySchema = z.object({
    type: z.literal(ServerTag.SetShipNameResult),
    outcome: z.enum(['ok', 'invalid', 'error']),
    message: Str.optional(),
});
export type SetShipNameReply = z.infer<typeof SetShipNameReplySchema>;

export const TowableMannedEntrySchema = z.object({
    playerId: Int,
    playerName: Str,
    clanNumber: IntOrNull,
    shipId: Int,
    shipName: Str,
    shipTypeName: Str,
    shipTypeDisplayName: StrOrNull,
    drones: Num,
});
export type TowableMannedEntry = z.infer<typeof TowableMannedEntrySchema>;

export const TowableUnmannedEntrySchema = z.object({
    shipId: Int,
    shipName: Str,
    shipTypeName: Str,
    shipTypeDisplayName: StrOrNull,
    drones: Num,
    ownership: OwnershipInfoSchema,
});
export type TowableUnmannedEntry = z.infer<typeof TowableUnmannedEntrySchema>;

const TowSpacecraftLit = z.literal(ServerTag.TowSpacecraftResult);
export const TowSpacecraftReplySchema = z.discriminatedUnion('outcome', [
    z.object({
        type: TowSpacecraftLit,
        outcome: z.literal('disengaged'),
        message: Str,
    }),
    z.object({ type: TowSpacecraftLit, outcome: z.literal('none') }),
    z.object({
        type: TowSpacecraftLit,
        outcome: z.literal('options'),
        sector: Int,
        manned: z.array(TowableMannedEntrySchema),
        unmanned: z.array(TowableUnmannedEntrySchema),
    }),
]);
export type TowSpacecraftReply = z.infer<typeof TowSpacecraftReplySchema>;

const TowAttachLit = z.literal(ServerTag.TowAttachResult);
export const TowAttachReplySchema = z.discriminatedUnion('outcome', [
    z.object({
        type: TowAttachLit,
        outcome: z.literal('ok'),
        message: Str,
        turnsPerWarp: Num,
    }),
    z.object({
        type: TowAttachLit,
        outcome: z.literal('error'),
        message: Str,
    }),
]);
export type TowAttachReply = z.infer<typeof TowAttachReplySchema>;

export const TowReleasedAlertEventSchema = z.object({
    type: z.literal(ServerTag.TowReleasedAlert),
    towedName: Str,
});
export type TowReleasedAlertEvent = z.infer<typeof TowReleasedAlertEventSchema>;

export const TowAttachedAlertEventSchema = z.object({
    type: z.literal(ServerTag.TowAttachedAlert),
    towingName: Str,
});
export type TowAttachedAlertEvent = z.infer<typeof TowAttachedAlertEventSchema>;

const HailResolveLit = z.literal(ServerTag.HailResolveResult);
export const HailResolveReplySchema = z.discriminatedUnion('outcome', [
    z.object({
        type: HailResolveLit,
        outcome: z.literal('found'),
        recipientPlayerId: Int,
        recipientName: Str,
        online: Bool,
    }),
    z.object({ type: HailResolveLit, outcome: z.literal('notFound') }),
    z.object({
        type: HailResolveLit,
        outcome: z.literal('ambiguous'),
        matches: z.array(Str),
    }),
    z.object({ type: HailResolveLit, outcome: z.literal('self') }),
]);
export type HailResolveReply = z.infer<typeof HailResolveReplySchema>;

const HailSendLit = z.literal(ServerTag.HailSendResult);
export const HailSendReplySchema = z.discriminatedUnion('outcome', [
    z.object({
        type: HailSendLit,
        outcome: z.enum(['delivered', 'queued']),
    }),
    z.object({
        type: HailSendLit,
        outcome: z.literal('error'),
        message: Str,
    }),
]);
export type HailSendReply = z.infer<typeof HailSendReplySchema>;

export const HailIncomingEventSchema = z.object({
    type: z.literal(ServerTag.HailIncoming),
    senderName: Str,
    body: Str,
});
export type HailIncomingEvent = z.infer<typeof HailIncomingEventSchema>;

export const ClanMemoNotificationEventSchema = z.object({
    type: z.literal(ServerTag.ClanMemoNotification),
    senderName: Str,
});
export type ClanMemoNotificationEvent = z.infer<typeof ClanMemoNotificationEventSchema>;

export const NoticeEventSchema = z.object({
    type: z.literal(ServerTag.Notice),
    senderLabel: StrOrNull,
    body: Str,
});
export type NoticeEvent = z.infer<typeof NoticeEventSchema>;

const ConstructPortInfoLit = z.literal(ServerTag.ConstructPortInfoResult);
export const ConstructPortInfoReplySchema = z.discriminatedUnion('mode', [
    z.object({
        type: ConstructPortInfoLit,
        mode: z.literal('build'),
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
                importExport: z.enum(['Import', 'Export']),
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
    }),
    z.object({ type: ConstructPortInfoLit, mode: z.literal('noPlanet') }),
    z.object({ type: ConstructPortInfoLit, mode: z.literal('hasPort') }),
]);
export type ConstructPortInfoReply = z.infer<typeof ConstructPortInfoReplySchema>;

const BuildPortLit = z.literal(ServerTag.BuildPortResult);
export const BuildPortReplySchema = z.discriminatedUnion('outcome', [
    z.object({
        type: BuildPortLit,
        outcome: z.literal('started'),
        portClass: Int,
        portName: Str,
        daysRequired: Num,
        credits: Num,
        experienceGained: Num,
        reputationGained: Num,
    }),
    z.object({
        type: BuildPortLit,
        outcome: z.literal('error'),
        message: Str,
    }),
]);
export type BuildPortReply = z.infer<typeof BuildPortReplySchema>;

const UpgradePortInfoLit = z.literal(ServerTag.UpgradePortInfoResult);
export const UpgradePortInfoReplySchema = z.discriminatedUnion('mode', [
    z.object({
        type: UpgradePortInfoLit,
        mode: z.literal('upgrade'),
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
    }),
    z.object({ type: UpgradePortInfoLit, mode: z.literal('noPort') }),
]);
export type UpgradePortInfoReply = z.infer<typeof UpgradePortInfoReplySchema>;

const UpgradePortLit = z.literal(ServerTag.UpgradePortResult);
export const UpgradePortReplySchema = z.discriminatedUnion('outcome', [
    z.object({
        type: UpgradePortLit,
        outcome: z.literal('upgraded'),
        commodity: Commodity3,
        units: Num,
        creditsSpent: Num,
        credits: Num,
        experienceGained: Num,
        reputationGained: Num,
        newProd: Num,
        newMax: Num,
        newStock: Num,
    }),
    z.object({
        type: UpgradePortLit,
        outcome: z.literal('error'),
        message: Str,
    }),
]);
export type UpgradePortReply = z.infer<typeof UpgradePortReplySchema>;

const HaggleOpenLit = z.literal(ServerTag.HaggleOpenResult);
export const HaggleOpenReplySchema = z.discriminatedUnion('outcome', [
    z.object({
        type: HaggleOpenLit,
        outcome: z.literal('opened'),
        commodity: Commodity3,
        action: z.enum(['buy', 'sell']),
        quantity: Num,
        initialOffer: Num,
    }),
    z.object({
        type: HaggleOpenLit,
        outcome: z.literal('error'),
        message: Str,
    }),
]);
export type HaggleOpenReply = z.infer<typeof HaggleOpenReplySchema>;

const BaseInfoLit = z.literal(ServerTag.BaseInfoResult);
export const BaseInfoReplySchema = z.discriminatedUnion('mode', [
    z.object({
        type: BaseInfoLit,
        mode: z.literal('noBase'),
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
    }),
    z.object({
        type: BaseInfoLit,
        mode: z.literal('constructing'),
        targetLevel: Int,
        startedAt: Str,
        completesAt: Str,
    }),
    z.object({
        type: BaseInfoLit,
        mode: z.literal('exists'),
        level: Int,
    }),
    z.object({
        type: BaseInfoLit,
        mode: z.literal('error'),
        message: Str,
    }),
]);
export type BaseInfoReply = z.infer<typeof BaseInfoReplySchema>;

const BuildBaseLit = z.literal(ServerTag.BuildBaseResult);
export const BuildBaseReplySchema = z.discriminatedUnion('outcome', [
    z.object({
        type: BuildBaseLit,
        outcome: z.literal('started'),
        targetLevel: Int,
        daysRequired: Num,
        completesAt: Str,
    }),
    z.object({
        type: BuildBaseLit,
        outcome: z.literal('error'),
        message: Str,
        shortfall: z
            .object({
                fuel: Num.optional(),
                org: Num.optional(),
                equ: Num.optional(),
                colos: Num.optional(),
            })
            .optional(),
    }),
]);
export type BuildBaseReply = z.infer<typeof BuildBaseReplySchema>;

export const ExitBaseReplySchema = z.object({
    type: z.literal(ServerTag.ExitBaseResult),
});
export type ExitBaseReply = z.infer<typeof ExitBaseReplySchema>;

const TreasuryInfoLit = z.literal(ServerTag.TreasuryInfoResult);
export const TreasuryInfoReplySchema = z.discriminatedUnion('outcome', [
    z.object({
        type: TreasuryInfoLit,
        outcome: z.literal('ok'),
        level: Int,
        treasury: Num,
        credits: Num,
    }),
    z.object({
        type: TreasuryInfoLit,
        outcome: z.literal('error'),
        message: Str,
    }),
]);
export type TreasuryInfoReply = z.infer<typeof TreasuryInfoReplySchema>;

const TreasuryTransferLit = z.literal(ServerTag.TreasuryTransferResult);
export const TreasuryTransferReplySchema = z.discriminatedUnion('outcome', [
    z.object({
        type: TreasuryTransferLit,
        outcome: z.literal('ok'),
        direction: z.enum(['to', 'from']),
        amount: Num,
        credits: Num,
        treasury: Num,
    }),
    z.object({
        type: TreasuryTransferLit,
        outcome: z.literal('error'),
        message: Str,
    }),
]);
export type TreasuryTransferReply = z.infer<typeof TreasuryTransferReplySchema>;

const BwarpInfoLit = z.literal(ServerTag.BwarpInfoResult);
export const BwarpInfoReplySchema = z.discriminatedUnion('outcome', [
    z.object({
        type: BwarpInfoLit,
        outcome: z.literal('notInstalled'),
        installCost: Num,
        initRange: Num,
    }),
    z.object({
        type: BwarpInfoLit,
        outcome: z.literal('installed'),
        range: Num,
        upgradeCost: Num,
        fuelPerHop: Num,
    }),
    z.object({
        type: BwarpInfoLit,
        outcome: z.literal('error'),
        message: Str,
    }),
]);
export type BwarpInfoReply = z.infer<typeof BwarpInfoReplySchema>;

const BwarpInstallLit = z.literal(ServerTag.BwarpInstallResult);
export const BwarpInstallReplySchema = z.discriminatedUnion('outcome', [
    z.object({
        type: BwarpInstallLit,
        outcome: z.literal('ok'),
        range: Num,
        credits: Num,
    }),
    z.object({
        type: BwarpInstallLit,
        outcome: z.literal('error'),
        message: Str,
    }),
]);
export type BwarpInstallReply = z.infer<typeof BwarpInstallReplySchema>;

const BwarpUpgradeLit = z.literal(ServerTag.BwarpUpgradeResult);
export const BwarpUpgradeReplySchema = z.discriminatedUnion('outcome', [
    z.object({
        type: BwarpUpgradeLit,
        outcome: z.literal('ok'),
        range: Num,
        cost: Num,
        credits: Num,
        treasury: Num,
    }),
    z.object({
        type: BwarpUpgradeLit,
        outcome: z.literal('error'),
        message: Str,
    }),
]);
export type BwarpUpgradeReply = z.infer<typeof BwarpUpgradeReplySchema>;

const BwarpBeamLit = z.literal(ServerTag.BwarpBeamResult);
export const BwarpBeamReplySchema = z.discriminatedUnion('outcome', [
    z.object({
        type: BwarpBeamLit,
        outcome: z.literal('distance'),
        targetSector: Int,
        hops: Int,
        range: Num,
        fuelCost: Num,
        planetFuel: Num,
    }),
    z.object({
        type: BwarpBeamLit,
        outcome: z.literal('beamed'),
        targetSector: Int,
        hops: Int,
        fuelUsed: Num,
        turnsUsed: Num,
    }),
    z.object({
        type: BwarpBeamLit,
        outcome: z.literal('error'),
        message: Str,
    }),
]);
export type BwarpBeamReply = z.infer<typeof BwarpBeamReplySchema>;

const HaggleResponseLit = z.literal(ServerTag.HaggleResponseResult);
export const HaggleResponseReplySchema = z.discriminatedUnion('outcome', [
    z.object({
        type: HaggleResponseLit,
        outcome: z.literal('accepted'),
        finalTotal: Num,
        credits: Num,
        cargo: CargoSchema,
        emptyHolds: Num,
        turnsUsed: Num.optional(),
        experienceGained: Num.optional(),
    }),
    z.object({
        type: HaggleResponseLit,
        outcome: z.literal('counter'),
        newPortOffer: Num,
    }),
    z.object({
        type: HaggleResponseLit,
        outcome: z.literal('final'),
        newPortOffer: Num,
    }),
    z.object({
        type: HaggleResponseLit,
        outcome: z.literal('rejected'),
        message: Str,
        turnsUsed: Num.optional(),
    }),
    z.object({
        type: HaggleResponseLit,
        outcome: z.literal('error'),
        message: Str,
    }),
]);
export type HaggleResponseReply = z.infer<typeof HaggleResponseReplySchema>;

export const ServerEnvelopeSchema = z.discriminatedUnion('type', [
    WelcomeEventSchema,
    PlayerMovedEventSchema,
    SectorDisplayReplySchema,
    MoveReplySchema,
    UndockReplySchema,
    JettisonReplySchema,
    LeavePlanetReplySchema,
    LeaveStarbaseReplySchema,
    PlayerLeftEventSchema,
    PlayersOnlineReplySchema,
    NoShipReplySchema,
    NonAdjacentMoveReplySchema,
    RateLimitedEventSchema,
    WarpsOutReplySchema,
    ShortestPathReplySchema,
    PortInfoReplySchema,
    ShipInfoReplySchema,
    PortTransactionReplySchema,
    BuyDronesReplySchema,
    BuyShieldsReplySchema,
    BuyHoldsReplySchema,
    BuyShipTradeinReplySchema,
    AttackShipReplySchema,
    DockReplySchema,
    PlanetInfoReplySchema,
    TakeColonistsReplySchema,
    LeaveColonistsReplySchema,
    TakeCommodityReplySchema,
    LeaveCommodityReplySchema,
    ChangePopulationReplySchema,
    DeployDronesInfoReplySchema,
    DeployDronesReplySchema,
    AttackSectorDronesReplySchema,
    RetreatFromDronesReplySchema,
    SectorDronesAlertEventSchema,
    UseTerraformDeviceReplySchema,
    GetSectorPlanetsReplySchema,
    LandOnPlanetReplySchema,
    PlanetDisplayReplySchema,
    DestroyPlanetReplySchema,
    BuyHardwareReplySchema,
    DockStarbaseReplySchema,
    BuyShipNewReplySchema,
    ListDeployedDronesReplySchema,
    ListPlanetsReplySchema,
    HyperspaceJumpReplySchema,
    VisitedSectorsReplySchema,
    PreviousSectorReplySchema,
    GetAttackTargetsReplySchema,
    StarbaseInfoReplySchema,
    TerraformInfoReplySchema,
    HardwareStoreInfoReplySchema,
    NeighborhoodReplySchema,
    DeployMineInfoReplySchema,
    DeployMineReplySchema,
    ListDeployedMinesReplySchema,
    TrackSeekerMinesReplySchema,
    MineDisruptorReplySchema,
    ProximityMineHitEventSchema,
    SeekerMineAttachedEventSchema,
    SeekerMinePickupAlertEventSchema,
    ListOwnedShipsReplySchema,
    ShipDetailReplySchema,
    TransportToShipReplySchema,
    ClanCreateReplySchema,
    ClanJoinReplySchema,
    ClanLeaveReplySchema,
    ClanListReplySchema,
    ClanInfoReplySchema,
    ChangeShipOwnershipReplySchema,
    ClaimPlanetReplySchema,
    ClanTransferReplySchema,
    ClanMemoReplySchema,
    ClanSetPasswordReplySchema,
    ClanDropMemberReplySchema,
    ClanMembershipChangedEventSchema,
    ReleaseBeaconReplySchema,
    AttackBeaconReplySchema,
    DensityScanReplySchema,
    VisualScanReplySchema,
    MemoDeliveryEventSchema,
    ShipNameRequiredEventSchema,
    SetShipNameReplySchema,
    TowSpacecraftReplySchema,
    TowAttachReplySchema,
    TowReleasedAlertEventSchema,
    TowAttachedAlertEventSchema,
    HailResolveReplySchema,
    HailSendReplySchema,
    HailIncomingEventSchema,
    ClanMemoNotificationEventSchema,
    NoticeEventSchema,
    ConstructPortInfoReplySchema,
    BuildPortReplySchema,
    UpgradePortInfoReplySchema,
    UpgradePortReplySchema,
    HaggleOpenReplySchema,
    HaggleResponseReplySchema,
    BaseInfoReplySchema,
    BuildBaseReplySchema,
    ExitBaseReplySchema,
    TreasuryInfoReplySchema,
    TreasuryTransferReplySchema,
    BwarpInfoReplySchema,
    BwarpInstallReplySchema,
    BwarpUpgradeReplySchema,
    BwarpBeamReplySchema,
    ErrorReplySchema,
]);
export type ServerEnvelope = z.infer<typeof ServerEnvelopeSchema>;
