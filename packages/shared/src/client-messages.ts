// WebSocket messages (client → server)

import { ClientMsgType } from './messages.js';

export type MoveCommand = {
    type: typeof ClientMsgType.Move;
    sector: number;
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

export type CargoInfoCommand = {
    type: typeof ClientMsgType.CargoInfo;
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
};

export type LeaveColonistsCommand = {
    type: typeof ClientMsgType.LeaveColonists;
    quantity: number;
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

export type BuyPlanetBustersCommand = {
    type: typeof ClientMsgType.BuyPlanetBusters;
    quantity: number;
};

export type BuyTerraformDevicesCommand = {
    type: typeof ClientMsgType.BuyTerraformDevices;
    quantity: number;
};

export type DockStarbaseCommand = {
    type: typeof ClientMsgType.DockStarbase;
};

export type LeaveStarbaseCommand = {
    type: typeof ClientMsgType.LeaveStarbase;
};

export type BuyHyperwarpDriveCommand = {
    type: typeof ClientMsgType.BuyHyperwarpDrive;
};

export type BuyBuoysCommand = {
    type: typeof ClientMsgType.BuyBuoys;
    quantity: number;
};

export type BuyProximityMinesCommand = {
    type: typeof ClientMsgType.BuyProximityMines;
    quantity: number;
};

export type BuySeekerMinesCommand = {
    type: typeof ClientMsgType.BuySeekerMines;
    quantity: number;
};

export type BuyOrbitalMinesCommand = {
    type: typeof ClientMsgType.BuyOrbitalMines;
    quantity: number;
};

export type BuyMineDisruptorsCommand = {
    type: typeof ClientMsgType.BuyMineDisruptors;
    quantity: number;
};

export type BuyHyperspaceDriveCommand = {
    type: typeof ClientMsgType.BuyHyperspaceDrive;
    driveType: 1 | 2;
};

export type BuyVisualScannerCommand = {
    type: typeof ClientMsgType.BuyVisualScanner;
};

export type BuyPlanetScannerCommand = {
    type: typeof ClientMsgType.BuyPlanetScanner;
};

export type BuyCloakingDeviceCommand = {
    type: typeof ClientMsgType.BuyCloakingDevice;
    quantity: number;
};

export type BuyCorbomiteCommand = {
    type: typeof ClientMsgType.BuyCorbomite;
    quantity: number;
};

export type BuyPhotonTorpedoesCommand = {
    type: typeof ClientMsgType.BuyPhotonTorpedoes;
    quantity: number;
};

export type BuyReconDronesCommand = {
    type: typeof ClientMsgType.BuyReconDrones;
    quantity: number;
};

export type ListDeployedDronesCommand = {
    type: typeof ClientMsgType.ListDeployedDrones;
};

export type HyperspaceJumpCommand = {
    type: typeof ClientMsgType.HyperspaceJump;
    targetSector: number;
};

export type ChangeMenuCommand = {
    type: typeof ClientMsgType.ChangeMenu;
    menu: string;
};

export type ClientCommand =
    | MoveCommand
    | SectorDisplayCommand
    | PlayersOnlineCommand
    | WarpsOutCommand
    | ShortestPathCommand
    | PortInfoCommand
    | ShipInfoCommand
    | CargoInfoCommand
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
    | BuyPlanetBustersCommand
    | BuyTerraformDevicesCommand
    | DockStarbaseCommand
    | LeaveStarbaseCommand
    | BuyHyperwarpDriveCommand
    | BuyBuoysCommand
    | BuyProximityMinesCommand
    | BuySeekerMinesCommand
    | BuyOrbitalMinesCommand
    | BuyMineDisruptorsCommand
    | BuyHyperspaceDriveCommand
    | BuyVisualScannerCommand
    | BuyPlanetScannerCommand
    | BuyCloakingDeviceCommand
    | BuyCorbomiteCommand
    | BuyPhotonTorpedoesCommand
    | BuyReconDronesCommand
    | ListDeployedDronesCommand
    | HyperspaceJumpCommand
    | ChangeMenuCommand;
