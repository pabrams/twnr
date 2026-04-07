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

export type BuyFightersCommand = {
    type: typeof ClientMsgType.BuyFighters;
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
    fighters: number;
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

export type DeployFightersInfoCommand = {
    type: typeof ClientMsgType.DeployFightersInfo;
};

export type DeployFightersCommand = {
    type: typeof ClientMsgType.DeployFighters;
    quantity: number;
};

export type AttackSectorFightersCommand = {
    type: typeof ClientMsgType.AttackSectorFighters;
    fighters: number;
};

export type RetreatFromFightersCommand = {
    type: typeof ClientMsgType.RetreatFromFighters;
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

export type DockStardockCommand = {
    type: typeof ClientMsgType.DockStardock;
};

export type LeaveStardockCommand = {
    type: typeof ClientMsgType.LeaveStardock;
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
    | BuyFightersCommand
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
    | DeployFightersInfoCommand
    | DeployFightersCommand
    | AttackSectorFightersCommand
    | RetreatFromFightersCommand
    | UseTerraformDeviceCommand
    | LandOnPlanetCommand
    | PlanetDisplayCommand
    | DestroyPlanetCommand
    | LeavePlanetCommand
    | BuyPlanetBustersCommand
    | BuyTerraformDevicesCommand
    | DockStardockCommand
    | LeaveStardockCommand
    | ChangeMenuCommand;
