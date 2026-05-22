// WebSocket messages (client → server). Each export pairs a zod schema
// (used for parsing untrusted JSON at the WS boundary) with the inferred
// TypeScript type, so existing consumers can keep importing the type name.

import { z } from 'zod';
import { ClientTag } from './tags.js';

const Commodity3 = z.enum(['fuel', 'organics', 'equipment']);
const Commodity4 = z.enum(['fuel', 'organics', 'equipment', 'drones']);
const Ownership = z.enum(['personal', 'clan']);
const MineType = z.enum(['proximity', 'seeker']);
const TradeAction = z.enum(['buy', 'sell']);
const Int = z.number().int();

export const MoveCommandSchema = z.object({
    type: z.literal(ClientTag.Move),
    sector: Int,
});
export type MoveCommand = z.infer<typeof MoveCommandSchema>;

export const MoveToPreviousCommandSchema = z.object({
    type: z.literal(ClientTag.MoveToPrevious),
});
export type MoveToPreviousCommand = z.infer<typeof MoveToPreviousCommandSchema>;

export const GetAttackTargetsCommandSchema = z.object({
    type: z.literal(ClientTag.GetAttackTargets),
});
export type GetAttackTargetsCommand = z.infer<typeof GetAttackTargetsCommandSchema>;

export const StarbaseInfoCommandSchema = z.object({
    type: z.literal(ClientTag.StarbaseInfo),
});
export type StarbaseInfoCommand = z.infer<typeof StarbaseInfoCommandSchema>;

export const TerraformInfoCommandSchema = z.object({
    type: z.literal(ClientTag.TerraformInfo),
});
export type TerraformInfoCommand = z.infer<typeof TerraformInfoCommandSchema>;

export const HardwareStoreInfoCommandSchema = z.object({
    type: z.literal(ClientTag.HardwareStoreInfo),
});
export type HardwareStoreInfoCommand = z.infer<typeof HardwareStoreInfoCommandSchema>;

export const SectorDisplayCommandSchema = z.object({
    type: z.literal(ClientTag.SectorDisplay),
});
export type SectorDisplayCommand = z.infer<typeof SectorDisplayCommandSchema>;

export const PlayersOnlineCommandSchema = z.object({
    type: z.literal(ClientTag.PlayersOnline),
});
export type PlayersOnlineCommand = z.infer<typeof PlayersOnlineCommandSchema>;

export const WarpsOutCommandSchema = z.object({
    type: z.literal(ClientTag.WarpsOut),
    id: Int,
});
export type WarpsOutCommand = z.infer<typeof WarpsOutCommandSchema>;

export const ShortestPathCommandSchema = z.object({
    type: z.literal(ClientTag.ShortestPath),
    from: Int,
    to: Int,
});
export type ShortestPathCommand = z.infer<typeof ShortestPathCommandSchema>;

export const PortInfoCommandSchema = z.object({
    type: z.literal(ClientTag.PortInfo),
    sectorId: Int,
});
export type PortInfoCommand = z.infer<typeof PortInfoCommandSchema>;

export const ShipInfoCommandSchema = z.object({
    type: z.literal(ClientTag.ShipInfo),
});
export type ShipInfoCommand = z.infer<typeof ShipInfoCommandSchema>;

export const PortTransactionCommandSchema = z.object({
    type: z.literal(ClientTag.PortTransaction),
    good: z.string(),
    quantity: Int,
    action: TradeAction,
});
export type PortTransactionCommand = z.infer<typeof PortTransactionCommandSchema>;

export const BuyDronesCommandSchema = z.object({
    type: z.literal(ClientTag.BuyDrones),
    quantity: Int,
});
export type BuyDronesCommand = z.infer<typeof BuyDronesCommandSchema>;

export const BuyShieldsCommandSchema = z.object({
    type: z.literal(ClientTag.BuyShields),
    quantity: Int,
});
export type BuyShieldsCommand = z.infer<typeof BuyShieldsCommandSchema>;

export const BuyHoldsCommandSchema = z.object({
    type: z.literal(ClientTag.BuyHolds),
    quantity: Int,
});
export type BuyHoldsCommand = z.infer<typeof BuyHoldsCommandSchema>;

export const BuyShipTradeinCommandSchema = z.object({
    type: z.literal(ClientTag.BuyShipTradein),
    targetShipName: z.string(),
});
export type BuyShipTradeinCommand = z.infer<typeof BuyShipTradeinCommandSchema>;

export const AttackShipCommandSchema = z.object({
    type: z.literal(ClientTag.AttackShip),
    targetPlayerId: Int,
    drones: Int,
});
export type AttackShipCommand = z.infer<typeof AttackShipCommandSchema>;

export const DockCommandSchema = z.object({
    type: z.literal(ClientTag.Dock),
});
export type DockCommand = z.infer<typeof DockCommandSchema>;

export const UndockCommandSchema = z.object({
    type: z.literal(ClientTag.Undock),
});
export type UndockCommand = z.infer<typeof UndockCommandSchema>;

export const JettisonCommandSchema = z.object({
    type: z.literal(ClientTag.Jettison),
});
export type JettisonCommand = z.infer<typeof JettisonCommandSchema>;

export const GetSectorPlanetsCommandSchema = z.object({
    type: z.literal(ClientTag.GetSectorPlanets),
});
export type GetSectorPlanetsCommand = z.infer<typeof GetSectorPlanetsCommandSchema>;

export const TakeColonistsCommandSchema = z.object({
    type: z.literal(ClientTag.TakeColonists),
    quantity: Int,
    commodity: Commodity3,
});
export type TakeColonistsCommand = z.infer<typeof TakeColonistsCommandSchema>;

export const LeaveColonistsCommandSchema = z.object({
    type: z.literal(ClientTag.LeaveColonists),
    quantity: Int,
    commodity: Commodity3,
});
export type LeaveColonistsCommand = z.infer<typeof LeaveColonistsCommandSchema>;

export const TakeCommodityCommandSchema = z.object({
    type: z.literal(ClientTag.TakeCommodity),
    quantity: Int,
    commodity: Commodity4,
});
export type TakeCommodityCommand = z.infer<typeof TakeCommodityCommandSchema>;

export const LeaveCommodityCommandSchema = z.object({
    type: z.literal(ClientTag.LeaveCommodity),
    quantity: Int,
    commodity: Commodity4,
});
export type LeaveCommodityCommand = z.infer<typeof LeaveCommodityCommandSchema>;

export const ChangePopulationCommandSchema = z.object({
    type: z.literal(ClientTag.ChangePopulation),
    quantity: Int,
    from: Commodity3,
    to: Commodity3,
});
export type ChangePopulationCommand = z.infer<typeof ChangePopulationCommandSchema>;

export const DeployDronesInfoCommandSchema = z.object({
    type: z.literal(ClientTag.DeployDronesInfo),
});
export type DeployDronesInfoCommand = z.infer<typeof DeployDronesInfoCommandSchema>;

export const DeployDronesCommandSchema = z.object({
    type: z.literal(ClientTag.DeployDrones),
    quantity: Int,
    ownership: Ownership.optional(),
});
export type DeployDronesCommand = z.infer<typeof DeployDronesCommandSchema>;

export const AttackSectorDronesCommandSchema = z.object({
    type: z.literal(ClientTag.AttackSectorDrones),
    drones: Int,
});
export type AttackSectorDronesCommand = z.infer<typeof AttackSectorDronesCommandSchema>;

export const RetreatFromDronesCommandSchema = z.object({
    type: z.literal(ClientTag.RetreatFromDrones),
});
export type RetreatFromDronesCommand = z.infer<typeof RetreatFromDronesCommandSchema>;

export const UseTerraformDeviceCommandSchema = z.object({
    type: z.literal(ClientTag.UseTerraformDevice),
});
export type UseTerraformDeviceCommand = z.infer<typeof UseTerraformDeviceCommandSchema>;

export const LandOnPlanetCommandSchema = z.object({
    type: z.literal(ClientTag.LandOnPlanet),
    planetId: Int,
});
export type LandOnPlanetCommand = z.infer<typeof LandOnPlanetCommandSchema>;

export const PlanetDisplayCommandSchema = z.object({
    type: z.literal(ClientTag.PlanetDisplay),
});
export type PlanetDisplayCommand = z.infer<typeof PlanetDisplayCommandSchema>;

export const DestroyPlanetCommandSchema = z.object({
    type: z.literal(ClientTag.DestroyPlanet),
});
export type DestroyPlanetCommand = z.infer<typeof DestroyPlanetCommandSchema>;

export const LeavePlanetCommandSchema = z.object({
    type: z.literal(ClientTag.LeavePlanet),
});
export type LeavePlanetCommand = z.infer<typeof LeavePlanetCommandSchema>;

export const BuyHardwareCommandSchema = z.object({
    type: z.literal(ClientTag.BuyHardware),
    itemName: z.string(),
    quantity: Int.optional(),
});
export type BuyHardwareCommand = z.infer<typeof BuyHardwareCommandSchema>;

export const DockStarbaseCommandSchema = z.object({
    type: z.literal(ClientTag.DockStarbase),
});
export type DockStarbaseCommand = z.infer<typeof DockStarbaseCommandSchema>;

export const LeaveStarbaseCommandSchema = z.object({
    type: z.literal(ClientTag.LeaveStarbase),
});
export type LeaveStarbaseCommand = z.infer<typeof LeaveStarbaseCommandSchema>;

export const BuyShipNewCommandSchema = z.object({
    type: z.literal(ClientTag.BuyShipNew),
    targetShipName: z.string(),
});
export type BuyShipNewCommand = z.infer<typeof BuyShipNewCommandSchema>;

export const ListDeployedDronesCommandSchema = z.object({
    type: z.literal(ClientTag.ListDeployedDrones),
});
export type ListDeployedDronesCommand = z.infer<typeof ListDeployedDronesCommandSchema>;

export const ListPlanetsCommandSchema = z.object({
    type: z.literal(ClientTag.ListPlanets),
});
export type ListPlanetsCommand = z.infer<typeof ListPlanetsCommandSchema>;

export const ListOwnedShipsCommandSchema = z.object({
    type: z.literal(ClientTag.ListOwnedShips),
});
export type ListOwnedShipsCommand = z.infer<typeof ListOwnedShipsCommandSchema>;

export const GetShipDetailCommandSchema = z.object({
    type: z.literal(ClientTag.GetShipDetail),
    shipId: Int,
});
export type GetShipDetailCommand = z.infer<typeof GetShipDetailCommandSchema>;

export const ReleaseBeaconCommandSchema = z.object({
    type: z.literal(ClientTag.ReleaseBeacon),
    message: z.string(),
});
export type ReleaseBeaconCommand = z.infer<typeof ReleaseBeaconCommandSchema>;

export const AttackBeaconCommandSchema = z.object({
    type: z.literal(ClientTag.AttackBeacon),
});
export type AttackBeaconCommand = z.infer<typeof AttackBeaconCommandSchema>;

export const DensityScanCommandSchema = z.object({
    type: z.literal(ClientTag.DensityScan),
});
export type DensityScanCommand = z.infer<typeof DensityScanCommandSchema>;

export const VisualScanCommandSchema = z.object({
    type: z.literal(ClientTag.VisualScan),
});
export type VisualScanCommand = z.infer<typeof VisualScanCommandSchema>;

export const SetShipNameCommandSchema = z.object({
    type: z.literal(ClientTag.SetShipName),
    name: z.string(),
});
export type SetShipNameCommand = z.infer<typeof SetShipNameCommandSchema>;

export const TowSpacecraftCommandSchema = z.object({
    type: z.literal(ClientTag.TowSpacecraft),
});
export type TowSpacecraftCommand = z.infer<typeof TowSpacecraftCommandSchema>;

export const TowAttachCommandSchema = z.object({
    type: z.literal(ClientTag.TowAttach),
    shipId: Int,
});
export type TowAttachCommand = z.infer<typeof TowAttachCommandSchema>;

export const ReadMailCommandSchema = z.object({
    type: z.literal(ClientTag.ReadMail),
});
export type ReadMailCommand = z.infer<typeof ReadMailCommandSchema>;

export const CheckMailSinceLastLogoutCommandSchema = z.object({
    type: z.literal(ClientTag.CheckMailSinceLastLogout),
});
export type CheckMailSinceLastLogoutCommand = z.infer<typeof CheckMailSinceLastLogoutCommandSchema>;

export const DeleteAllMailCommandSchema = z.object({
    type: z.literal(ClientTag.DeleteAllMail),
});
export type DeleteAllMailCommand = z.infer<typeof DeleteAllMailCommandSchema>;

export const HailResolveCommandSchema = z.object({
    type: z.literal(ClientTag.HailResolve),
    name: z.string(),
});
export type HailResolveCommand = z.infer<typeof HailResolveCommandSchema>;

export const HailSendCommandSchema = z.object({
    type: z.literal(ClientTag.HailSend),
    recipientPlayerId: Int,
    body: z.string(),
});
export type HailSendCommand = z.infer<typeof HailSendCommandSchema>;

export const TransportToShipCommandSchema = z.object({
    type: z.literal(ClientTag.TransportToShip),
    shipId: Int,
});
export type TransportToShipCommand = z.infer<typeof TransportToShipCommandSchema>;

export const ClanCreateCommandSchema = z.object({
    type: z.literal(ClientTag.ClanCreate),
    name: z.string(),
    password: z.string(),
});
export type ClanCreateCommand = z.infer<typeof ClanCreateCommandSchema>;

export const ClanJoinCommandSchema = z.object({
    type: z.literal(ClientTag.ClanJoin),
    name: z.string(),
    password: z.string(),
});
export type ClanJoinCommand = z.infer<typeof ClanJoinCommandSchema>;

export const ClanLeaveCommandSchema = z.object({
    type: z.literal(ClientTag.ClanLeave),
    successorPlayerId: Int.optional(),
    confirmDissolve: z.boolean().optional(),
});
export type ClanLeaveCommand = z.infer<typeof ClanLeaveCommandSchema>;

export const ClanListCommandSchema = z.object({
    type: z.literal(ClientTag.ClanList),
});
export type ClanListCommand = z.infer<typeof ClanListCommandSchema>;

export const ClanInfoCommandSchema = z.object({
    type: z.literal(ClientTag.ClanInfo),
});
export type ClanInfoCommand = z.infer<typeof ClanInfoCommandSchema>;

export const ChangeShipOwnershipCommandSchema = z.object({
    type: z.literal(ClientTag.ChangeShipOwnership),
    ownership: Ownership,
});
export type ChangeShipOwnershipCommand = z.infer<typeof ChangeShipOwnershipCommandSchema>;

export const ClaimPlanetCommandSchema = z.object({
    type: z.literal(ClientTag.ClaimPlanet),
    ownership: Ownership,
});
export type ClaimPlanetCommand = z.infer<typeof ClaimPlanetCommandSchema>;

export const ClanTransferKindSchema = z.enum(['credits', 'drones', 'shields', 'mines']);
export type ClanTransferKind = z.infer<typeof ClanTransferKindSchema>;

export const ClanTransferCommandSchema = z.object({
    type: z.literal(ClientTag.ClanTransfer),
    kind: ClanTransferKindSchema,
    targetPlayerId: Int,
    quantity: Int,
    mineType: MineType.optional(),
});
export type ClanTransferCommand = z.infer<typeof ClanTransferCommandSchema>;

export const ClanMemoCommandSchema = z.object({
    type: z.literal(ClientTag.ClanMemo),
    body: z.string(),
});
export type ClanMemoCommand = z.infer<typeof ClanMemoCommandSchema>;

export const ClanSetPasswordCommandSchema = z.object({
    type: z.literal(ClientTag.ClanSetPassword),
    newPassword: z.string(),
});
export type ClanSetPasswordCommand = z.infer<typeof ClanSetPasswordCommandSchema>;

export const ClanDropMemberCommandSchema = z.object({
    type: z.literal(ClientTag.ClanDropMember),
    targetPlayerId: Int,
});
export type ClanDropMemberCommand = z.infer<typeof ClanDropMemberCommandSchema>;

export const HyperspaceJumpCommandSchema = z.object({
    type: z.literal(ClientTag.HyperspaceJump),
    targetSector: Int,
});
export type HyperspaceJumpCommand = z.infer<typeof HyperspaceJumpCommandSchema>;

export const VisitedSectorsCommandSchema = z.object({
    type: z.literal(ClientTag.VisitedSectors),
});
export type VisitedSectorsCommand = z.infer<typeof VisitedSectorsCommandSchema>;

export const DeployMineInfoCommandSchema = z.object({
    type: z.literal(ClientTag.DeployMineInfo),
    mineType: MineType,
});
export type DeployMineInfoCommand = z.infer<typeof DeployMineInfoCommandSchema>;

export const DeployMineCommandSchema = z.object({
    type: z.literal(ClientTag.DeployMine),
    mineType: MineType,
    quantity: Int,
    ownership: Ownership.optional(),
});
export type DeployMineCommand = z.infer<typeof DeployMineCommandSchema>;

export const ListDeployedMinesCommandSchema = z.object({
    type: z.literal(ClientTag.ListDeployedMines),
});
export type ListDeployedMinesCommand = z.infer<typeof ListDeployedMinesCommandSchema>;

export const TrackSeekerMinesCommandSchema = z.object({
    type: z.literal(ClientTag.TrackSeekerMines),
});
export type TrackSeekerMinesCommand = z.infer<typeof TrackSeekerMinesCommandSchema>;

export const MineDisruptorCommandSchema = z.object({
    type: z.literal(ClientTag.MineDisruptor),
    targetSector: Int,
});
export type MineDisruptorCommand = z.infer<typeof MineDisruptorCommandSchema>;

// halfWidthWorld/halfHeightWorld and optional center are floats (world units),
// not ints. Sectors are scoped by visited set unless admin.
export const GetNeighborhoodCommandSchema = z.object({
    type: z.literal(ClientTag.GetNeighborhood),
    halfWidthWorld: z.number(),
    halfHeightWorld: z.number(),
    centerXWorld: z.number().optional(),
    centerYWorld: z.number().optional(),
});
export type GetNeighborhoodCommand = z.infer<typeof GetNeighborhoodCommandSchema>;

export const ConstructPortInfoCommandSchema = z.object({
    type: z.literal(ClientTag.ConstructPortInfo),
});
export type ConstructPortInfoCommand = z.infer<typeof ConstructPortInfoCommandSchema>;

export const BuildPortCommandSchema = z.object({
    type: z.literal(ClientTag.BuildPort),
    portClass: Int,
    portName: z.string(),
});
export type BuildPortCommand = z.infer<typeof BuildPortCommandSchema>;

export const UpgradePortInfoCommandSchema = z.object({
    type: z.literal(ClientTag.UpgradePortInfo),
});
export type UpgradePortInfoCommand = z.infer<typeof UpgradePortInfoCommandSchema>;

export const UpgradePortCommandSchema = z.object({
    type: z.literal(ClientTag.UpgradePort),
    commodity: Commodity3,
    units: Int,
});
export type UpgradePortCommand = z.infer<typeof UpgradePortCommandSchema>;

export const HaggleOpenCommandSchema = z.object({
    type: z.literal(ClientTag.HaggleOpen),
    commodity: Commodity3,
    quantity: Int,
    action: TradeAction,
});
export type HaggleOpenCommand = z.infer<typeof HaggleOpenCommandSchema>;

export const HaggleCounterCommandSchema = z.object({
    type: z.literal(ClientTag.HaggleCounter),
    counter: Int,
});
export type HaggleCounterCommand = z.infer<typeof HaggleCounterCommandSchema>;

export const HaggleAcceptCommandSchema = z.object({
    type: z.literal(ClientTag.HaggleAccept),
});
export type HaggleAcceptCommand = z.infer<typeof HaggleAcceptCommandSchema>;

export const HaggleQuitCommandSchema = z.object({
    type: z.literal(ClientTag.HaggleQuit),
});
export type HaggleQuitCommand = z.infer<typeof HaggleQuitCommandSchema>;

export const BaseInfoCommandSchema = z.object({
    type: z.literal(ClientTag.BaseInfo),
});
export type BaseInfoCommand = z.infer<typeof BaseInfoCommandSchema>;

export const BuildBaseCommandSchema = z.object({
    type: z.literal(ClientTag.BuildBase),
});
export type BuildBaseCommand = z.infer<typeof BuildBaseCommandSchema>;

export const ExitBaseCommandSchema = z.object({
    type: z.literal(ClientTag.ExitBase),
});
export type ExitBaseCommand = z.infer<typeof ExitBaseCommandSchema>;

export const TreasuryInfoCommandSchema = z.object({
    type: z.literal(ClientTag.TreasuryInfo),
});
export type TreasuryInfoCommand = z.infer<typeof TreasuryInfoCommandSchema>;

export const TreasuryTransferCommandSchema = z.object({
    type: z.literal(ClientTag.TreasuryTransfer),
    direction: z.enum(['to', 'from']),
    amount: Int,
});
export type TreasuryTransferCommand = z.infer<typeof TreasuryTransferCommandSchema>;

export const BwarpInfoCommandSchema = z.object({
    type: z.literal(ClientTag.BwarpInfo),
});
export type BwarpInfoCommand = z.infer<typeof BwarpInfoCommandSchema>;

export const BwarpInstallCommandSchema = z.object({
    type: z.literal(ClientTag.BwarpInstall),
});
export type BwarpInstallCommand = z.infer<typeof BwarpInstallCommandSchema>;

export const BwarpUpgradeCommandSchema = z.object({
    type: z.literal(ClientTag.BwarpUpgrade),
});
export type BwarpUpgradeCommand = z.infer<typeof BwarpUpgradeCommandSchema>;

export const BwarpBeamCommandSchema = z.object({
    type: z.literal(ClientTag.BwarpBeam),
    targetSector: Int,
    commit: z.boolean(),
});
export type BwarpBeamCommand = z.infer<typeof BwarpBeamCommandSchema>;

export const ClientEnvelopeSchema = z.discriminatedUnion('type', [
    MoveCommandSchema,
    MoveToPreviousCommandSchema,
    GetAttackTargetsCommandSchema,
    StarbaseInfoCommandSchema,
    TerraformInfoCommandSchema,
    HardwareStoreInfoCommandSchema,
    SectorDisplayCommandSchema,
    PlayersOnlineCommandSchema,
    WarpsOutCommandSchema,
    ShortestPathCommandSchema,
    PortInfoCommandSchema,
    ShipInfoCommandSchema,
    PortTransactionCommandSchema,
    BuyDronesCommandSchema,
    BuyShieldsCommandSchema,
    BuyHoldsCommandSchema,
    BuyShipTradeinCommandSchema,
    AttackShipCommandSchema,
    DockCommandSchema,
    UndockCommandSchema,
    JettisonCommandSchema,
    GetSectorPlanetsCommandSchema,
    TakeColonistsCommandSchema,
    LeaveColonistsCommandSchema,
    TakeCommodityCommandSchema,
    LeaveCommodityCommandSchema,
    ChangePopulationCommandSchema,
    DeployDronesInfoCommandSchema,
    DeployDronesCommandSchema,
    AttackSectorDronesCommandSchema,
    RetreatFromDronesCommandSchema,
    UseTerraformDeviceCommandSchema,
    LandOnPlanetCommandSchema,
    PlanetDisplayCommandSchema,
    DestroyPlanetCommandSchema,
    LeavePlanetCommandSchema,
    BuyHardwareCommandSchema,
    DockStarbaseCommandSchema,
    LeaveStarbaseCommandSchema,
    BuyShipNewCommandSchema,
    ListDeployedDronesCommandSchema,
    ListPlanetsCommandSchema,
    HyperspaceJumpCommandSchema,
    VisitedSectorsCommandSchema,
    GetNeighborhoodCommandSchema,
    DeployMineInfoCommandSchema,
    DeployMineCommandSchema,
    ListDeployedMinesCommandSchema,
    TrackSeekerMinesCommandSchema,
    MineDisruptorCommandSchema,
    ListOwnedShipsCommandSchema,
    GetShipDetailCommandSchema,
    TransportToShipCommandSchema,
    ReleaseBeaconCommandSchema,
    AttackBeaconCommandSchema,
    DensityScanCommandSchema,
    VisualScanCommandSchema,
    SetShipNameCommandSchema,
    TowSpacecraftCommandSchema,
    TowAttachCommandSchema,
    ReadMailCommandSchema,
    CheckMailSinceLastLogoutCommandSchema,
    DeleteAllMailCommandSchema,
    HailResolveCommandSchema,
    HailSendCommandSchema,
    ClanCreateCommandSchema,
    ClanJoinCommandSchema,
    ClanLeaveCommandSchema,
    ClanListCommandSchema,
    ClanInfoCommandSchema,
    ChangeShipOwnershipCommandSchema,
    ClaimPlanetCommandSchema,
    ClanTransferCommandSchema,
    ClanMemoCommandSchema,
    ClanSetPasswordCommandSchema,
    ClanDropMemberCommandSchema,
    ConstructPortInfoCommandSchema,
    BuildPortCommandSchema,
    UpgradePortInfoCommandSchema,
    UpgradePortCommandSchema,
    HaggleOpenCommandSchema,
    HaggleCounterCommandSchema,
    HaggleAcceptCommandSchema,
    HaggleQuitCommandSchema,
    BaseInfoCommandSchema,
    BuildBaseCommandSchema,
    ExitBaseCommandSchema,
    TreasuryInfoCommandSchema,
    TreasuryTransferCommandSchema,
    BwarpInfoCommandSchema,
    BwarpInstallCommandSchema,
    BwarpUpgradeCommandSchema,
    BwarpBeamCommandSchema,
]);
export type ClientEnvelope = z.infer<typeof ClientEnvelopeSchema>;
