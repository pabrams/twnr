// WebSocket messages (client → server)

import { ClientMsgType } from './messages.js';

export type MoveCommand = {
    type: typeof ClientMsgType.Move;
    sector: number;
};

export type MoveToPreviousCommand = {
    type: typeof ClientMsgType.MoveToPrevious;
};

export type AttackCommand = {
    type: typeof ClientMsgType.Attack;
};

export type StarbaseInfoCommand = {
    type: typeof ClientMsgType.StarbaseInfo;
};

export type TerraformInfoCommand = {
    type: typeof ClientMsgType.TerraformInfo;
};

export type HardwareStoreInfoCommand = {
    type: typeof ClientMsgType.HardwareStoreInfo;
};

export type SectorDisplayCommand = {
    type: typeof ClientMsgType.SectorDisplay;
};

export type PlayersOnlineCommand = {
    type: typeof ClientMsgType.PlayersOnline;
};

export type WarpsOutCommand = {
    type: typeof ClientMsgType.WarpsOut;
    id: number;
};

export type ShortestPathCommand = {
    type: typeof ClientMsgType.ShortestPath;
    from: number;
    to: number;
};

export type PortInfoCommand = {
    type: typeof ClientMsgType.PortInfo;
    sectorId: number;
};

export type ShipInfoCommand = {
    type: typeof ClientMsgType.ShipInfo;
};

export type PortTransactionCommand = {
    type: typeof ClientMsgType.PortTransaction;
    good: string;
    quantity: number;
    action: 'buy' | 'sell';
};

export type BuyDronesCommand = {
    type: typeof ClientMsgType.BuyDrones;
    quantity: number;
};

export type BuyShieldsCommand = {
    type: typeof ClientMsgType.BuyShields;
    quantity: number;
};

export type BuyHoldsCommand = {
    type: typeof ClientMsgType.BuyHolds;
    quantity: number;
};

export type BuyShipTradeinCommand = {
    type: typeof ClientMsgType.BuyShipTradein;
    targetShipName: string;
};
export type AttackShipCommand = {
    type: typeof ClientMsgType.AttackShip;
    targetPlayerId: number;
    drones: number;
};

export type DockCommand = {
    type: typeof ClientMsgType.Dock;
};

export type UndockCommand = {
    type: typeof ClientMsgType.Undock;
};

export type JettisonCommand = {
    type: typeof ClientMsgType.Jettison;
};

export type LandCommand = {
    type: typeof ClientMsgType.Land;
};

export type TakeColonistsCommand = {
    type: typeof ClientMsgType.TakeColonists;
    quantity: number;
    commodity: 'fuel' | 'organics' | 'equipment';
};

export type LeaveColonistsCommand = {
    type: typeof ClientMsgType.LeaveColonists;
    quantity: number;
    commodity: 'fuel' | 'organics' | 'equipment';
};

export type DeployDronesInfoCommand = {
    type: typeof ClientMsgType.DeployDronesInfo;
};

export type DeployDronesCommand = {
    type: typeof ClientMsgType.DeployDrones;
    quantity: number;
};

export type AttackSectorDronesCommand = {
    type: typeof ClientMsgType.AttackSectorDrones;
    drones: number;
};

export type RetreatFromDronesCommand = {
    type: typeof ClientMsgType.RetreatFromDrones;
};

export type UseTerraformDeviceCommand = {
    type: typeof ClientMsgType.UseTerraformDevice;
};

export type LandOnPlanetCommand = {
    type: typeof ClientMsgType.LandOnPlanet;
    planetId: number;
};

export type PlanetDisplayCommand = {
    type: typeof ClientMsgType.PlanetDisplay;
};

export type DestroyPlanetCommand = {
    type: typeof ClientMsgType.DestroyPlanet;
};

export type LeavePlanetCommand = {
    type: typeof ClientMsgType.LeavePlanet;
};

export type BuyHardwareCommand = {
    type: typeof ClientMsgType.BuyHardware;
    itemName: string;
    quantity?: number;
};

export type DockStarbaseCommand = {
    type: typeof ClientMsgType.DockStarbase;
};

export type LeaveStarbaseCommand = {
    type: typeof ClientMsgType.LeaveStarbase;
};

export type BuyShipNewCommand = {
    type: typeof ClientMsgType.BuyShipNew;
    targetShipName: string;
};

export type ListDeployedDronesCommand = {
    type: typeof ClientMsgType.ListDeployedDrones;
};

export type ListPlanetsCommand = {
    type: typeof ClientMsgType.ListPlanets;
};

export type HyperspaceJumpCommand = {
    type: typeof ClientMsgType.HyperspaceJump;
    targetSector: number;
};

export type ChangeMenuCommand = {
    type: typeof ClientMsgType.ChangeMenu;
    menu: string;
};

export type VisitedSectorsCommand = {
    type: typeof ClientMsgType.VisitedSectors;
};

export type TradeResponseCommand = {
    type: typeof ClientMsgType.TradeResponse;
    quantity: number;
};

export type TradeConfirmResponseCommand = {
    type: typeof ClientMsgType.TradeConfirmResponse;
    confirmed: boolean;
};

export type DeployMineCommand = {
    type: typeof ClientMsgType.DeployMine;
    mineType: 'proximity' | 'seeker';
    quantity: number;
};

export type ListDeployedMinesCommand = {
    type: typeof ClientMsgType.ListDeployedMines;
};

export type TrackSeekerMinesCommand = {
    type: typeof ClientMsgType.TrackSeekerMines;
};

export type MineDisruptorCommand = {
    type: typeof ClientMsgType.MineDisruptor;
    targetSector: number;
};

export type GetNeighborhoodCommand = {
    type: typeof ClientMsgType.GetNeighborhood;
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

export type ClientCommand =
    | MoveCommand
    | MoveToPreviousCommand
    | AttackCommand
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
    | LandCommand
    | TakeColonistsCommand
    | LeaveColonistsCommand
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
    | ChangeMenuCommand
    | VisitedSectorsCommand
    | TradeResponseCommand
    | TradeConfirmResponseCommand
    | GetNeighborhoodCommand
    | DeployMineCommand
    | ListDeployedMinesCommand
    | TrackSeekerMinesCommand
    | MineDisruptorCommand;
