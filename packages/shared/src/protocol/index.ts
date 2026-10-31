// The protocol registry. Everything below the two registries is derived.
import { z } from 'zod';
import type { MessageDef } from './define.js';
import * as session from './session.js';
import * as movement from './movement.js';
import * as port from './port.js';
import * as planet from './planet.js';
import * as base from './base.js';
import * as combat from './combat.js';
import * as ship from './ship.js';
import * as clan from './clan.js';
import * as messaging from './messaging.js';
import * as catalog from './catalog.js';

export * from './common.js';
export { MenuNameSchema } from './session.js';
export {
    TowedAlongSchema,
    DensityScanEntrySchema,
    NeighborhoodSectorSchema,
    NeighborhoodWarpSchema,
    type TowedAlong,
    type DensityScanEntry,
    type NeighborhoodSector,
    type NeighborhoodWarp,
} from './movement.js';
export {
    CargoSchema,
    ShipInfoEmbedSchema,
    Class0PriceListSchema,
    HardwarePriceItemSchema,
    TradeAction,
    type Class0PriceList,
    type HardwarePriceItem,
} from './port.js';
export {
    Commodity4,
    PlanetDisplayDataSchema,
    SectorDisplayPartial,
    type PlanetDisplayData,
} from './planet.js';
export {
    DeployedMineEntrySchema,
    TrackedSeekerMineEntrySchema,
    type DeployedMineEntry,
    type TrackedSeekerMineEntry,
} from './combat.js';
export {
    HardwareStoreItemSchema,
    TowableMannedEntrySchema,
    TowableUnmannedEntrySchema,
    type HardwareStoreItem,
    type TowableMannedEntry,
    type TowableUnmannedEntry,
} from './ship.js';
export {
    ClanListEntrySchema,
    ClanMemberEntrySchema,
    ClanmateLocationEntrySchema,
    ClanTransferKindSchema,
    type ClanListEntry,
    type ClanMemberEntry,
    type ClanmateLocationEntry,
} from './clan.js';
export { GalacticNewsEntrySchema, type GalacticNewsEntry } from './messaging.js';
export {
    ShipCatalogEntrySchema,
    PlanetCatalogEntrySchema,
    HardwareCatalogItemSchema,
    TraderListEntrySchema,
    type ShipCatalogEntry,
    type PlanetCatalogEntry,
    type HardwareCatalogItem,
    type TraderListEntry,
} from './catalog.js';
export { defineCommand, defineEvent, defineReply, outcomes, variants } from './define.js';
export type { CommandDef, MessageDef, Envelope } from './define.js';

export const Commands = {
    Move: movement.Move,
    MoveToPrevious: movement.MoveToPrevious,
    SectorDisplay: movement.SectorDisplay,
    WarpsOut: movement.WarpsOut,
    ShortestPath: movement.ShortestPath,
    HyperspaceJump: movement.HyperspaceJump,
    GetNeighborhood: movement.GetNeighborhood,
    VisitedSectors: movement.VisitedSectors,
    DensityScan: movement.DensityScan,
    VisualScan: movement.VisualScan,
    PortInfo: port.PortInfo,
    Dock: port.Dock,
    Undock: port.Undock,
    Jettison: port.Jettison,
    PortTransaction: port.PortTransaction,
    DockStarbase: port.DockStarbase,
    LeaveStarbase: port.LeaveStarbase,
    HaggleOpen: port.HaggleOpen,
    HaggleCounter: port.HaggleCounter,
    HaggleAccept: port.HaggleAccept,
    HaggleQuit: port.HaggleQuit,
    ConstructPortInfo: port.ConstructPortInfo,
    BuildPort: port.BuildPort,
    UpgradePortInfo: port.UpgradePortInfo,
    UpgradePort: port.UpgradePort,
    GetSectorPlanets: planet.GetSectorPlanets,
    LandOnPlanet: planet.LandOnPlanet,
    PlanetDisplay: planet.PlanetDisplay,
    LeavePlanet: planet.LeavePlanet,
    DestroyPlanet: planet.DestroyPlanet,
    TerraformInfo: planet.TerraformInfo,
    UseTerraformDevice: planet.UseTerraformDevice,
    SetTerraformedPlanet: planet.SetTerraformedPlanet,
    TakeColonists: planet.TakeColonists,
    LeaveColonists: planet.LeaveColonists,
    TakeCommodity: planet.TakeCommodity,
    LeaveCommodity: planet.LeaveCommodity,
    ChangePopulation: planet.ChangePopulation,
    ListPlanets: planet.ListPlanets,
    ClaimPlanet: planet.ClaimPlanet,
    BaseInfo: base.BaseInfo,
    BuildBase: base.BuildBase,
    ExitBase: base.ExitBase,
    TreasuryInfo: base.TreasuryInfo,
    TreasuryTransfer: base.TreasuryTransfer,
    BwarpInfo: base.BwarpInfo,
    BwarpInstall: base.BwarpInstall,
    BwarpUpgrade: base.BwarpUpgrade,
    BwarpBeam: base.BwarpBeam,
    GetAttackTargets: combat.GetAttackTargets,
    AttackShip: combat.AttackShip,
    DeployDronesInfo: combat.DeployDronesInfo,
    DeployDrones: combat.DeployDrones,
    AttackSectorDrones: combat.AttackSectorDrones,
    RetreatFromDrones: combat.RetreatFromDrones,
    ListDeployedDrones: combat.ListDeployedDrones,
    DeployMineInfo: combat.DeployMineInfo,
    DeployMine: combat.DeployMine,
    ListDeployedMines: combat.ListDeployedMines,
    TrackSeekerMines: combat.TrackSeekerMines,
    MineDisruptor: combat.MineDisruptor,
    ReleaseBeacon: combat.ReleaseBeacon,
    AttackBeacon: combat.AttackBeacon,
    ShipInfo: ship.ShipInfo,
    BuyDrones: ship.BuyDrones,
    BuyShields: ship.BuyShields,
    BuyHolds: ship.BuyHolds,
    BuyShipNew: ship.BuyShipNew,
    BuyShipTradein: ship.BuyShipTradein,
    SetShipName: ship.SetShipName,
    HardwareStoreInfo: ship.HardwareStoreInfo,
    BuyHardware: ship.BuyHardware,
    ListOwnedShips: ship.ListOwnedShips,
    GetShipDetail: ship.GetShipDetail,
    TransportToShip: ship.TransportToShip,
    ChangeShipOwnership: ship.ChangeShipOwnership,
    TowSpacecraft: ship.TowSpacecraft,
    TowAttach: ship.TowAttach,
    ClanCreate: clan.ClanCreate,
    ClanJoin: clan.ClanJoin,
    ClanLeave: clan.ClanLeave,
    ClanList: clan.ClanList,
    ClanInfo: clan.ClanInfo,
    ClanTransfer: clan.ClanTransfer,
    ClanMemo: clan.ClanMemo,
    ClanSetPassword: clan.ClanSetPassword,
    ClanDropMember: clan.ClanDropMember,
    ClanmateLocations: clan.ClanmateLocations,
    ReadMail: messaging.ReadMail,
    CheckMailSinceLastLogout: messaging.CheckMailSinceLastLogout,
    DeleteAllMail: messaging.DeleteAllMail,
    HailResolve: messaging.HailResolve,
    HailSend: messaging.HailSend,
    GalacticNewsRange: messaging.GalacticNewsRange,
    ReadGalacticNews: messaging.ReadGalacticNews,
    PlayersOnline: catalog.PlayersOnline,
    StarbaseInfo: catalog.StarbaseInfo,
    TraderList: catalog.TraderList,
    ShipCatalog: catalog.ShipCatalog,
    PlanetCatalog: catalog.PlanetCatalog,
    HardwareCatalog: catalog.HardwareCatalog,
} as const;

export const Events = {
    Welcome: session.Welcome,
    RateLimited: session.RateLimited,
    Error: session.ProtocolError,
    StatsSnapshot: session.StatsSnapshot,
    PlayerMoved: movement.PlayerMoved,
    SectorActivity: movement.SectorActivity,
    PlayerLeft: movement.PlayerLeft,
    ProximityMineHit: movement.ProximityMineHit,
    SeekerMineAttached: movement.SeekerMineAttached,
    SeekerMinePickupAlert: movement.SeekerMinePickupAlert,
    PlanetDestroyedAlert: planet.PlanetDestroyedAlert,
    SectorDronesAlert: combat.SectorDronesAlert,
    ShipNameRequired: ship.ShipNameRequired,
    TowReleasedAlert: ship.TowReleasedAlert,
    TowAttachedAlert: ship.TowAttachedAlert,
    ClanMembershipChanged: clan.ClanMembershipChanged,
    ClanMemoNotification: clan.ClanMemoNotification,
    MemoDelivery: messaging.MemoDelivery,
    HailIncoming: messaging.HailIncoming,
    Notice: messaging.Notice,
} as const;

type C = typeof Commands;
type E = typeof Events;
export type CommandName = keyof C;
export type EventName = keyof E;

// Distributive over K so ReplyDefOf<CommandName> is the union of every reply definition.
type ReplyDefOf<K extends CommandName> = K extends CommandName
    ? C[K]['reply'] extends MessageDef<string, z.ZodType>
        ? C[K]['reply']
        : never
    : never;
type ReplyTagOf<K extends CommandName> = ReplyDefOf<K>['name'];

export type CommandRequest<K extends CommandName> = z.infer<C[K]['Request']>;
export type CommandReply<K extends CommandName> = z.infer<ReplyDefOf<K>['Schema']>;
export type EventPayload<K extends EventName> = z.infer<E[K]['Schema']>;

/** Wire `type` of each command's request, keyed by command name. */
export const ClientTag = Object.fromEntries(
    Object.entries(Commands).map(([key, def]) => [key, def.name]),
) as { readonly [K in CommandName]: C[K]['name'] };

/** Registry key of the command whose request carries this wire `type`. */
export const commandNameByType = new Map<string, CommandName>(
    (Object.entries(Commands) as [CommandName, C[CommandName]][]).map(([key, def]) => [
        def.name,
        key,
    ]),
);

/** Wire `type` of each reply (keyed `Capitalize<replyTag>`) and event (keyed by event name). */
export const ServerTag = {
    ...Object.fromEntries(
        Object.values(Commands)
            .filter((def) => def.reply !== null)
            .map((def) => [capitalize(def.reply!.name), def.reply!.name]),
    ),
    ...Object.fromEntries(Object.entries(Events).map(([key, def]) => [key, def.name])),
} as { readonly [K in CommandName as Capitalize<ReplyTagOf<K>>]: ReplyTagOf<K> } & {
    readonly [K in EventName]: E[K]['name'];
};

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

type RequestSchemas = C[CommandName]['Request'];
type ReplySchemas = ReplyDefOf<CommandName>['Schema'];
type EventSchemas = E[EventName]['Schema'];

const requestSchemas = Object.values(Commands).map((def) => def.Request);
// A reply definition may be shared by several commands, and an event may double
// as a reply (MemoDelivery), so the server union is deduplicated by wire type.
const serverSchemasByType = new Map<string, ReplySchemas | EventSchemas>();
for (const def of Object.values(Commands)) {
    if (def.reply) serverSchemasByType.set(def.reply.name, def.reply.Schema);
}
for (const def of Object.values(Events)) serverSchemasByType.set(def.name, def.Schema);
const serverSchemas = [...serverSchemasByType.values()];

export const ClientEnvelopeSchema = z.discriminatedUnion(
    'type',
    requestSchemas as [RequestSchemas, ...RequestSchemas[]],
);
export type ClientEnvelope = z.infer<typeof ClientEnvelopeSchema>;

export const ServerEnvelopeSchema = z.discriminatedUnion(
    'type',
    serverSchemas as [ReplySchemas | EventSchemas, ...(ReplySchemas | EventSchemas)[]],
);
export type ServerEnvelope = z.infer<typeof ServerEnvelopeSchema>;
