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

export type SectorDroneInfo = {
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
    sectorDrones?: SectorDroneInfo | null;
    planets: { id: number; name: string; type: string }[];
};

export type SectorDisplayResultObject = {
    type: typeof ServerMsgType.SectorDisplayResult;
} & SectorDisplayData;

export type MoveResultObject =
    | ({
          type: typeof ServerMsgType.MoveResult;
          outcome: 'success';
          turnsUsed?: number;
      } & SectorDisplayData)
    | {
          type: typeof ServerMsgType.MoveResult;
          outcome: 'encounter';
          sector: number;
          warps: number[];
          players: { id: number; name: string }[];
          port?: { class: number; name: string } | null;
          visitedSectors: number[];
          sectorDrones: number;
          ownerId: number;
          ownerName: string;
          shipDrones: number;
          retreatSector: number;
          turnsUsed?: number;
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
    drones: number;
    shields: number;
    maxDrones: number;
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
    turnsPerWarp: number;
    hasHyperwarpDrive: boolean;
    turns: number;
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
    turnsUsed?: number;
};

export type BuyDronesResultObject = {
    type: typeof ServerMsgType.BuyDronesResult;
    credits: number;
    drones: number;
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
    turnsUsed?: number;
};

export type BuyShipTradeinResultObject = {
    type: typeof ServerMsgType.BuyShipTradeinResult;
    shipName: string;
    credits: number;
    maxDrones: number;
    maxShields: number;
    cargoLimit: number;
};

export type AttackShipResultObject = {
    type: typeof ServerMsgType.AttackShipResult;
    destroyed: boolean;
    attackerDronesLost: number;
    defenderShieldsLost: number;
    defenderDronesLost: number;
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
    drones: number;
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

export type DockStarbaseResultObject = {
    type: typeof ServerMsgType.DockStarbaseResult;
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

// DroneEncounter embeds full sector display data (Oak's design) to avoid message ordering issues
export type DroneEncounterResultObject = {
    type: typeof ServerMsgType.DroneEncounter;
    sector: number;
    warps: number[];
    players: { id: number; name: string }[];
    port?: { class: number; name: string } | null;
    visitedSectors: number[];
    sectorDrones: number;
    ownerId: number;
    ownerName: string;
    shipDrones: number;
    retreatSector: number;
};

export type DeployDronesInfoResultObject = {
    type: typeof ServerMsgType.DeployDronesInfoResult;
    sectorDrones: number;
    shipDrones: number;
    shipMaxDrones: number;
};

export type DeployDronesResultObject = {
    type: typeof ServerMsgType.DeployDronesResult;
    sectorDrones: number;
    shipDrones: number;
};

export type AttackSectorDronesResultObject = {
    type: typeof ServerMsgType.AttackSectorDronesResult;
    victory: boolean;
    dronesLost: number;
    sectorDronesRemaining: number;
    shipDrones: number;
};

export type RetreatFromDronesResultObject = {
    type: typeof ServerMsgType.RetreatFromDronesResult;
    sector: number;
};

export type SectorDronesAlertEvent = {
    type: typeof ServerMsgType.SectorDronesAlert;
    event: 'intrusion' | 'attacked' | 'destroyed';
    sector: number;
    dronesLost: number;
    dronesRemaining: number;
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
    turnsUsed?: number;
} & SectorDisplayData;

export type LeaveStarbaseResultObject = {
    type: typeof ServerMsgType.LeaveStarbaseResult;
} & SectorDisplayData;

export type BuyHyperwarpDriveResultObject = {
    type: typeof ServerMsgType.BuyHyperwarpDriveResult;
    credits: number;
};

export type ListDeployedDronesResultObject = {
    type: typeof ServerMsgType.ListDeployedDronesResult;
    drones: { sectorId: number; quantity: number }[];
};

export type HyperspaceJumpResultObject = {
    type: typeof ServerMsgType.HyperspaceJumpResult;
    targetSector: number;
    fuelUsed: number;
    turnsUsed: number;
};

export type ErrorResultObject = {
    type: typeof ServerMsgType.Error;
    message: string;
};

export type MenuChangedResultObject = {
    type: typeof ServerMsgType.MenuChanged;
};

export type ServerResult =
    | WelcomeEvent
    | PlayerMovedEvent
    | SectorDisplayResultObject
    | MoveResultObject
    | UndockResultObject
    | JettisonResultObject
    | LeavePlanetResultObject
    | LeaveStarbaseResultObject
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
    | BuyDronesResultObject
    | BuyShieldsResultObject
    | BuyHoldsResultObject
    | BuyShipTradeinResultObject
    | AttackShipResultObject
    | DockResultObject
    | PlanetInfoResultObject
    | TakeColonistsResultObject
    | LeaveColonistsResultObject
    | DroneEncounterResultObject
    | DeployDronesInfoResultObject
    | DeployDronesResultObject
    | AttackSectorDronesResultObject
    | RetreatFromDronesResultObject
    | SectorDronesAlertEvent
    | UseTerraformDeviceResultObject
    | LandResultObject
    | LandOnPlanetResultObject
    | PlanetDisplayResultObject
    | DestroyPlanetResultObject
    | BuyPlanetBustersResultObject
    | BuyTerraformDevicesResultObject
    | DockStarbaseResultObject
    | BuyHyperwarpDriveResultObject
    | ListDeployedDronesResultObject
    | HyperspaceJumpResultObject
    | MenuChangedResultObject
    | ErrorResultObject;
