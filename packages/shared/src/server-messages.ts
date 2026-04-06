// WebSocket messages (server → client)

import { ServerMsgType } from './messages.js';

export type WelcomeEvent = {
    type: typeof ServerMsgType.Welcome;
    playerId: number;
    name: string;
    sector: number;
    token: string;
    totalSectors: number;
};

export type PlayerMovedEvent = {
    type: typeof ServerMsgType.PlayerMoved;
    playerId: number;
    sector: number;
    direction: 'in' | 'out';
};

export type SectorFighterInfo = {
    quantity: number;
    ownerId: number;
    ownerName: string;
};

export type SectorDisplayData = {
    sector: number;
    players: { id: number; name: string }[];
    warps: number[];
    port?: { class: number; name: string } | null;
    visitedSectors: number[];
    sectorFighters?: SectorFighterInfo | null;
    planets: { id: number; name: string; type: string }[];
};

export type SectorDisplayResultObject = {
    type: typeof ServerMsgType.SectorDisplayResult;
} & SectorDisplayData;

export type MoveResultObject =
    | ({ type: typeof ServerMsgType.MoveResult; outcome: 'success' } & SectorDisplayData)
    | {
          type: typeof ServerMsgType.MoveResult;
          outcome: 'encounter';
          sector: number;
          warps: number[];
          players: { id: number; name: string }[];
          port?: { class: number; name: string } | null;
          visitedSectors: number[];
          sectorFighters: number;
          ownerId: number;
          ownerName: string;
          shipFighters: number;
          retreatSector: number;
      }
    | { type: typeof ServerMsgType.MoveResult; outcome: 'nonAdjacent'; sector: number }
    | { type: typeof ServerMsgType.MoveResult; outcome: 'noShip' }
    | { type: typeof ServerMsgType.MoveResult; outcome: 'error'; message: string };

export type PlayerLeftEvent = {
    type: typeof ServerMsgType.PlayerLeft;
    playerId: number;
};

export type PlayersOnlineResultObject = {
    type: typeof ServerMsgType.PlayersOnlineResult;
    players: { id: number; name: string; sector: number }[];
};

export type NoShipResultObject = {
    type: typeof ServerMsgType.NoShip;
};

export type NonAdjacentMoveResultObject = {
    type: typeof ServerMsgType.NonAdjacentMoveRequested;
    playerId: number;
    sector: number;
};

export type RateLimitedEvent = {
    type: typeof ServerMsgType.RateLimited;
};

export type WarpsOutResultObject = {
    type: typeof ServerMsgType.WarpsOutResult;
    id: number;
    warps: number[];
};

export type ShortestPathResultObject = {
    type: typeof ServerMsgType.ShortestPathResult;
    path: number[];
    hops: number;
};

export type PortInfoResultObject = {
    type: typeof ServerMsgType.PortInfoResult;
    sectorId: number;
    class: number;
    fuel: number;
    fuelPrice: number;
    organics: number;
    orgPrice: number;
    equipment: number;
    equPrice: number;
};

export type ShipInfoResultObject = {
    type: typeof ServerMsgType.ShipInfoResult;
    playerId: number;
    shipName: string;
    fighters: number;
    shields: number;
    maxFighters: number;
    maxShields: number;
    cargoLimit: number;
    maxHolds: number;
    cargoFuel: number;
    cargoOrganics: number;
    cargoEquipment: number;
    cargoColonists: number;
    holdsAvailable: number;
    planetBusters: number;
    terraformDevices: number;
    maxPlanetBusters: number;
    maxTerraformDevices: number;
};

export type CargoInfoResultObject = {
    type: typeof ServerMsgType.CargoInfoResult;
    playerId: number;
    fuel: number;
    organics: number;
    equipment: number;
    colonists: number;
    credits: number;
};

export type PortTransactionResultObject = {
    type: typeof ServerMsgType.PortTransactionResult;
    credits: number;
    cargo: { fuel: number; organics: number; equipment: number; colonists: number };
};

export type BuyFightersResultObject = {
    type: typeof ServerMsgType.BuyFightersResult;
    credits: number;
    fighters: number;
};

export type BuyShieldsResultObject = {
    type: typeof ServerMsgType.BuyShieldsResult;
    credits: number;
    shields: number;
};

export type BuyHoldsResultObject = {
    type: typeof ServerMsgType.BuyHoldsResult;
    credits: number;
    cargoLimit: number;
};

export type BuyShipTradeinResultObject = {
    type: typeof ServerMsgType.BuyShipTradeinResult;
    shipName: string;
    credits: number;
    maxFighters: number;
    maxShields: number;
    cargoLimit: number;
};

export type AttackShipResultObject = {
    type: typeof ServerMsgType.AttackShipResult;
    destroyed: boolean;
    attackerFightersLost: number;
    defenderShieldsLost: number;
    defenderFightersLost: number;
    message?: string;
};

export type DockResultObject = {
    type: typeof ServerMsgType.DockResult;
    docked: boolean;
    port?: PortInfoResultObject;
};

export type PlanetInfoResultObject = {
    type: typeof ServerMsgType.PlanetInfoResult;
    sectorId: number;
    name: string;
    planetType: string;
    colonists: number;
    hasPlanet: boolean;
};

export type UseTerraformDeviceResultObject = {
    type: typeof ServerMsgType.UseTerraformDeviceResult;
    success: boolean;
    reason?: string;
    planet?: { id: number; name: string; type: string; sectorId: number };
    collision?: boolean;
    terraformDevices?: number;
};

export type LandResultObject = {
    type: typeof ServerMsgType.LandResult;
    planets: { id: number; name: string; type: string }[];
};

export type PlanetDisplayData = {
    id: number;
    sector_id: number;
    name: string;
    planetType: string;
    fighters: number;
    fuel: number;
    organics: number;
    equipment: number;
    colonists_fuel: number;
    colonists_organics: number;
    colonists_equipment: number;
    created_at: Date | string;
    updated_at?: Date | string | null;
};

export type LandOnPlanetResultObject = {
    type: typeof ServerMsgType.LandOnPlanetResult;
} & PlanetDisplayData;

export type PlanetDisplayResultObject = {
    type: typeof ServerMsgType.PlanetDisplayResult;
} & PlanetDisplayData;

export type DestroyPlanetResultObject = {
    type: typeof ServerMsgType.DestroyPlanetResult;
    destroyed: boolean;
    planetId: number;
    planetName: string;
};

export type BuyPlanetBustersResultObject = {
    type: typeof ServerMsgType.BuyPlanetBustersResult;
    quantity: number;
    totalOnShip: number;
    credits: number;
};

export type BuyTerraformDevicesResultObject = {
    type: typeof ServerMsgType.BuyTerraformDevicesResult;
    quantity: number;
    totalOnShip: number;
    credits: number;
};

export type DockStardockResultObject = {
    type: typeof ServerMsgType.DockStardockResult;
};

export type TakeColonistsResultObject = {
    type: typeof ServerMsgType.TakeColonistsResult;
    quantity: number;
    planetColonists: number;
    holdsUsed: number;
    holdsFree: number;
};

export type LeaveColonistsResultObject = {
    type: typeof ServerMsgType.LeaveColonistsResult;
    quantity: number;
    planetColonists: number;
    holdsUsed: number;
    holdsFree: number;
};

// FighterEncounter embeds full sector display data (Oak's design) to avoid message ordering issues
export type FighterEncounterResultObject = {
    type: typeof ServerMsgType.FighterEncounter;
    sector: number;
    warps: number[];
    players: { id: number; name: string }[];
    port?: { class: number; name: string } | null;
    visitedSectors: number[];
    sectorFighters: number;
    ownerId: number;
    ownerName: string;
    shipFighters: number;
    retreatSector: number;
};

export type DeployFightersInfoResultObject = {
    type: typeof ServerMsgType.DeployFightersInfoResult;
    sectorFighters: number;
    shipFighters: number;
    shipMaxFighters: number;
};

export type DeployFightersResultObject = {
    type: typeof ServerMsgType.DeployFightersResult;
    sectorFighters: number;
    shipFighters: number;
};

export type AttackSectorFightersResultObject = {
    type: typeof ServerMsgType.AttackSectorFightersResult;
    victory: boolean;
    fightersLost: number;
    sectorFightersRemaining: number;
    shipFighters: number;
};

export type RetreatFromFightersResultObject = {
    type: typeof ServerMsgType.RetreatFromFightersResult;
    sector: number;
};

export type SectorFightersAlertEvent = {
    type: typeof ServerMsgType.SectorFightersAlert;
    event: 'intrusion' | 'attacked' | 'destroyed';
    sector: number;
    fightersLost: number;
    fightersRemaining: number;
    intruderName: string;
};

export type JettisonResultObject =
    | {
          type: typeof ServerMsgType.JettisonResult;
          outcome: 'success';
          jettisoned: { fuel: number; organics: number; equipment: number; colonists: number };
      }
    | { type: typeof ServerMsgType.JettisonResult; outcome: 'error'; message: string };

export type UndockResultObject =
    | ({ type: typeof ServerMsgType.UndockResult; outcome: 'success' } & SectorDisplayData)
    | { type: typeof ServerMsgType.UndockResult; outcome: 'error'; message: string };

export type LeavePlanetResultObject = {
    type: typeof ServerMsgType.LeavePlanetResult;
} & SectorDisplayData;

export type LeaveStardockResultObject = {
    type: typeof ServerMsgType.LeaveStardockResult;
} & SectorDisplayData;

export type ErrorResultObject = {
    type: typeof ServerMsgType.Error;
    message: string;
};

export type ServerResult =
    | WelcomeEvent
    | PlayerMovedEvent
    | SectorDisplayResultObject
    | MoveResultObject
    | UndockResultObject
    | JettisonResultObject
    | LeavePlanetResultObject
    | LeaveStardockResultObject
    | PlayerLeftEvent
    | PlayersOnlineResultObject
    | NoShipResultObject
    | NonAdjacentMoveResultObject
    | RateLimitedEvent
    | WarpsOutResultObject
    | ShortestPathResultObject
    | PortInfoResultObject
    | ShipInfoResultObject
    | CargoInfoResultObject
    | PortTransactionResultObject
    | BuyFightersResultObject
    | BuyShieldsResultObject
    | BuyHoldsResultObject
    | BuyShipTradeinResultObject
    | AttackShipResultObject
    | DockResultObject
    | PlanetInfoResultObject
    | TakeColonistsResultObject
    | LeaveColonistsResultObject
    | FighterEncounterResultObject
    | DeployFightersInfoResultObject
    | DeployFightersResultObject
    | AttackSectorFightersResultObject
    | RetreatFromFightersResultObject
    | SectorFightersAlertEvent
    | UseTerraformDeviceResultObject
    | LandResultObject
    | LandOnPlanetResultObject
    | PlanetDisplayResultObject
    | DestroyPlanetResultObject
    | BuyPlanetBustersResultObject
    | BuyTerraformDevicesResultObject
    | DockStardockResultObject
    | ErrorResultObject;
