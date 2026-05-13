// WebSocket messages (client → server)

import { ClientTag } from './tags.js';

export type MoveCommand = {
    type: typeof ClientTag.Move;
    sector: number;
};

export type MoveToPreviousCommand = {
    type: typeof ClientTag.MoveToPrevious;
};

export type GetAttackTargetsCommand = {
    type: typeof ClientTag.GetAttackTargets;
};

export type StarbaseInfoCommand = {
    type: typeof ClientTag.StarbaseInfo;
};

export type TerraformInfoCommand = {
    type: typeof ClientTag.TerraformInfo;
};

export type HardwareStoreInfoCommand = {
    type: typeof ClientTag.HardwareStoreInfo;
};

export type SectorDisplayCommand = {
    type: typeof ClientTag.SectorDisplay;
};

export type PlayersOnlineCommand = {
    type: typeof ClientTag.PlayersOnline;
};

export type WarpsOutCommand = {
    type: typeof ClientTag.WarpsOut;
    id: number;
};

export type ShortestPathCommand = {
    type: typeof ClientTag.ShortestPath;
    from: number;
    to: number;
};

export type PortInfoCommand = {
    type: typeof ClientTag.PortInfo;
    sectorId: number;
};

export type ShipInfoCommand = {
    type: typeof ClientTag.ShipInfo;
};

export type PortTransactionCommand = {
    type: typeof ClientTag.PortTransaction;
    good: string;
    quantity: number;
    action: 'buy' | 'sell';
};

export type BuyDronesCommand = {
    type: typeof ClientTag.BuyDrones;
    quantity: number;
};

export type BuyShieldsCommand = {
    type: typeof ClientTag.BuyShields;
    quantity: number;
};

export type BuyHoldsCommand = {
    type: typeof ClientTag.BuyHolds;
    quantity: number;
};

export type BuyShipTradeinCommand = {
    type: typeof ClientTag.BuyShipTradein;
    targetShipName: string;
};
export type AttackShipCommand = {
    type: typeof ClientTag.AttackShip;
    targetPlayerId: number;
    drones: number;
};

export type DockCommand = {
    type: typeof ClientTag.Dock;
};

export type UndockCommand = {
    type: typeof ClientTag.Undock;
};

export type JettisonCommand = {
    type: typeof ClientTag.Jettison;
};

export type GetSectorPlanetsCommand = {
    type: typeof ClientTag.GetSectorPlanets;
};

export type TakeColonistsCommand = {
    type: typeof ClientTag.TakeColonists;
    quantity: number;
    commodity: 'fuel' | 'organics' | 'equipment' | 'drones';
};

export type LeaveColonistsCommand = {
    type: typeof ClientTag.LeaveColonists;
    quantity: number;
    commodity: 'fuel' | 'organics' | 'equipment' | 'drones';
};

export type TakeCommodityCommand = {
    type: typeof ClientTag.TakeCommodity;
    quantity: number;
    commodity: 'fuel' | 'organics' | 'equipment' | 'drones';
};

export type LeaveCommodityCommand = {
    type: typeof ClientTag.LeaveCommodity;
    quantity: number;
    commodity: 'fuel' | 'organics' | 'equipment' | 'drones';
};

export type DeployDronesInfoCommand = {
    type: typeof ClientTag.DeployDronesInfo;
};

export type DeployDronesCommand = {
    type: typeof ClientTag.DeployDrones;
    quantity: number;
    ownership?: 'personal' | 'clan';
};

export type AttackSectorDronesCommand = {
    type: typeof ClientTag.AttackSectorDrones;
    drones: number;
};

export type RetreatFromDronesCommand = {
    type: typeof ClientTag.RetreatFromDrones;
};

export type UseTerraformDeviceCommand = {
    type: typeof ClientTag.UseTerraformDevice;
};

export type LandOnPlanetCommand = {
    type: typeof ClientTag.LandOnPlanet;
    planetId: number;
};

export type PlanetDisplayCommand = {
    type: typeof ClientTag.PlanetDisplay;
};

export type DestroyPlanetCommand = {
    type: typeof ClientTag.DestroyPlanet;
};

export type LeavePlanetCommand = {
    type: typeof ClientTag.LeavePlanet;
};

export type BuyHardwareCommand = {
    type: typeof ClientTag.BuyHardware;
    itemName: string;
    quantity?: number;
};

export type DockStarbaseCommand = {
    type: typeof ClientTag.DockStarbase;
};

export type LeaveStarbaseCommand = {
    type: typeof ClientTag.LeaveStarbase;
};

export type BuyShipNewCommand = {
    type: typeof ClientTag.BuyShipNew;
    targetShipName: string;
};

export type ListDeployedDronesCommand = {
    type: typeof ClientTag.ListDeployedDrones;
};

export type ListPlanetsCommand = {
    type: typeof ClientTag.ListPlanets;
};

export type ListOwnedShipsCommand = {
    type: typeof ClientTag.ListOwnedShips;
};

export type GetShipDetailCommand = {
    type: typeof ClientTag.GetShipDetail;
    shipId: number;
};

export type ReleaseBeaconCommand = {
    type: typeof ClientTag.ReleaseBeacon;
    message: string;
};

export type AttackBeaconCommand = {
    type: typeof ClientTag.AttackBeacon;
};

export type DensityScanCommand = {
    type: typeof ClientTag.DensityScan;
};

export type VisualScanCommand = {
    type: typeof ClientTag.VisualScan;
};

export type SetShipNameCommand = {
    type: typeof ClientTag.SetShipName;
    name: string;
};

export type TransportToShipCommand = {
    type: typeof ClientTag.TransportToShip;
    shipId: number;
};

export type ClanCreateCommand = {
    type: typeof ClientTag.ClanCreate;
    name: string;
    password: string;
};

export type ClanJoinCommand = {
    type: typeof ClientTag.ClanJoin;
    name: string;
    password: string;
};

export type ClanLeaveCommand = {
    type: typeof ClientTag.ClanLeave;
    /** Required when leaving as leader with other members remaining. */
    successorPlayerId?: number;
    /** Required when leaving as the last member (triggers dissolution). */
    confirmDissolve?: boolean;
};

export type ClanListCommand = {
    type: typeof ClientTag.ClanList;
};

export type ClanInfoCommand = {
    type: typeof ClientTag.ClanInfo;
};

export type ChangeShipOwnershipCommand = {
    type: typeof ClientTag.ChangeShipOwnership;
    ownership: 'personal' | 'clan';
};

export type ClaimPlanetCommand = {
    type: typeof ClientTag.ClaimPlanet;
    ownership: 'personal' | 'clan';
};

export type ClanTransferKind = 'credits' | 'drones' | 'shields' | 'mines';
export type ClanTransferCommand = {
    type: typeof ClientTag.ClanTransfer;
    kind: ClanTransferKind;
    targetPlayerId: number;
    quantity: number;
    mineType?: 'proximity' | 'seeker';
};

export type ClanMemoCommand = {
    type: typeof ClientTag.ClanMemo;
    body: string;
};

export type ClanSetPasswordCommand = {
    type: typeof ClientTag.ClanSetPassword;
    newPassword: string;
};

export type ClanDropMemberCommand = {
    type: typeof ClientTag.ClanDropMember;
    targetPlayerId: number;
};

export type HyperspaceJumpCommand = {
    type: typeof ClientTag.HyperspaceJump;
    targetSector: number;
};

export type VisitedSectorsCommand = {
    type: typeof ClientTag.VisitedSectors;
};

export type DeployMineInfoCommand = {
    type: typeof ClientTag.DeployMineInfo;
    mineType: 'proximity' | 'seeker';
};

export type DeployMineCommand = {
    type: typeof ClientTag.DeployMine;
    mineType: 'proximity' | 'seeker';
    quantity: number;
    ownership?: 'personal' | 'clan';
};

export type ListDeployedMinesCommand = {
    type: typeof ClientTag.ListDeployedMines;
};

export type TrackSeekerMinesCommand = {
    type: typeof ClientTag.TrackSeekerMines;
};

export type MineDisruptorCommand = {
    type: typeof ClientTag.MineDisruptor;
    targetSector: number;
};

export type GetNeighborhoodCommand = {
    type: typeof ClientTag.GetNeighborhood;
    /**
     * Half-extent of the visible viewport in world units (axis-aligned bbox).
     * Server returns sectors with |x - cx| ≤ halfWidthWorld and
     * |y - cy| ≤ halfHeightWorld, still scoped by the player's
     * visited/glimpsed set unless they are an admin.
     */
    halfWidthWorld: number;
    halfHeightWorld: number;
    /**
     * Optional viewport center in world units. When omitted, the server
     * centers on the player's current sector. Used by the client when the
     * user has panned/zoomed-toward-cursor away from the player position.
     */
    centerXWorld?: number;
    centerYWorld?: number;
};

export type ClientEnvelope =
    | MoveCommand
    | MoveToPreviousCommand
    | GetAttackTargetsCommand
    | StarbaseInfoCommand
    | TerraformInfoCommand
    | HardwareStoreInfoCommand
    | SectorDisplayCommand
    | PlayersOnlineCommand
    | WarpsOutCommand
    | ShortestPathCommand
    | PortInfoCommand
    | ShipInfoCommand
    | PortTransactionCommand
    | BuyDronesCommand
    | BuyShieldsCommand
    | BuyHoldsCommand
    | BuyShipTradeinCommand
    | AttackShipCommand
    | DockCommand
    | UndockCommand
    | JettisonCommand
    | GetSectorPlanetsCommand
    | TakeColonistsCommand
    | LeaveColonistsCommand
    | TakeCommodityCommand
    | LeaveCommodityCommand
    | DeployDronesInfoCommand
    | DeployDronesCommand
    | AttackSectorDronesCommand
    | RetreatFromDronesCommand
    | UseTerraformDeviceCommand
    | LandOnPlanetCommand
    | PlanetDisplayCommand
    | DestroyPlanetCommand
    | LeavePlanetCommand
    | BuyHardwareCommand
    | DockStarbaseCommand
    | LeaveStarbaseCommand
    | BuyShipNewCommand
    | ListDeployedDronesCommand
    | ListPlanetsCommand
    | HyperspaceJumpCommand
    | VisitedSectorsCommand
    | GetNeighborhoodCommand
    | DeployMineInfoCommand
    | DeployMineCommand
    | ListDeployedMinesCommand
    | TrackSeekerMinesCommand
    | MineDisruptorCommand
    | ListOwnedShipsCommand
    | GetShipDetailCommand
    | TransportToShipCommand
    | ReleaseBeaconCommand
    | AttackBeaconCommand
    | DensityScanCommand
    | VisualScanCommand
    | SetShipNameCommand
    | ClanCreateCommand
    | ClanJoinCommand
    | ClanLeaveCommand
    | ClanListCommand
    | ClanInfoCommand
    | ChangeShipOwnershipCommand
    | ClaimPlanetCommand
    | ClanTransferCommand
    | ClanMemoCommand
    | ClanSetPasswordCommand
    | ClanDropMemberCommand;
