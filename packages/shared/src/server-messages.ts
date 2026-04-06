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

export type SectorDisplayMessage = {
    type: typeof ServerMsgType.SectorDisplay;
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

export type PlayersOnlineMessage = {
    type: typeof ServerMsgType.PlayersOnline;
    players: { id: number; name: string; sector: number }[];
};

export type NoShipMessage = {
    type: typeof ServerMsgType.NoShip;
};

export type NonAdjacentMoveMessage = {
    type: typeof ServerMsgType.NonAdjacentMoveRequested;
    playerId: number;
    sector: number;
};

export type RateLimitedEvent = {
    type: typeof ServerMsgType.RateLimited;
};

export type SectorWarpsMessage = {
    type: typeof ServerMsgType.SectorWarps;
    id: number;
    warps: number[];
};

export type PathResultMessage = {
    type: typeof ServerMsgType.PathResult;
    path: number[];
    hops: number;
};

export type PortInfoMessage = {
    type: typeof ServerMsgType.PortInfo;
    sectorId: number;
    class: number;
    fuel: number;
    fuelPrice: number;
    organics: number;
    orgPrice: number;
    equipment: number;
    equPrice: number;
};

export type ShipInfoMessage = {
    type: typeof ServerMsgType.ShipInfo;
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

export type CargoInfoMessage = {
    type: typeof ServerMsgType.CargoInfo;
    playerId: number;
    fuel: number;
    organics: number;
    equipment: number;
    colonists: number;
    credits: number;
};

export type PortTransactionResultMessage = {
    type: typeof ServerMsgType.PortTransactionResult;
    credits: number;
    cargo: { fuel: number; organics: number; equipment: number; colonists: number };
};

export type BuyFightersResultMessage = {
    type: typeof ServerMsgType.BuyFightersResult;
    credits: number;
    fighters: number;
};

export type BuyShieldsResultMessage = {
    type: typeof ServerMsgType.BuyShieldsResult;
    credits: number;
    shields: number;
};

export type BuyHoldsResultMessage = {
    type: typeof ServerMsgType.BuyHoldsResult;
    credits: number;
    cargoLimit: number;
};

export type ShipExchangeResultMessage = {
    type: typeof ServerMsgType.ShipExchangeResult;
    shipName: string;
    credits: number;
    maxFighters: number;
    maxShields: number;
    cargoLimit: number;
};

export type AttackResultMessage = {
    type: typeof ServerMsgType.AttackResult;
    destroyed: boolean;
    attackerFightersLost: number;
    defenderShieldsLost: number;
    defenderFightersLost: number;
    message?: string;
};

export type DockResultMessage = {
    type: typeof ServerMsgType.DockResult;
    docked: boolean;
    port?: PortInfoMessage;
};

export type PlanetInfoMessage = {
    type: typeof ServerMsgType.PlanetInfo;
    sectorId: number;
    name: string;
    planetType: string;
    colonists: number;
    hasPlanet: boolean;
};

export type TerraformResultMessage = {
    type: typeof ServerMsgType.TerraformResult;
    success: boolean;
    reason?: string;
    planet?: { id: number; name: string; type: string; sectorId: number };
    collision?: boolean;
    terraformDevices?: number;
};

export type PlanetListMessage = {
    type: typeof ServerMsgType.PlanetList;
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

export type LandOnPlanetResultMessage = {
    type: typeof ServerMsgType.LandOnPlanetResult;
} & PlanetDisplayData;

export type PlanetDisplayResultMessage = {
    type: typeof ServerMsgType.PlanetDisplayResult;
} & PlanetDisplayData;

export type DestroyPlanetResultMessage = {
    type: typeof ServerMsgType.DestroyPlanetResult;
    destroyed: boolean;
    planetId: number;
    planetName: string;
};

export type BuyPlanetBustersResultMessage = {
    type: typeof ServerMsgType.BuyPlanetBustersResult;
    quantity: number;
    totalOnShip: number;
    credits: number;
};

export type BuyTerraformDevicesResultMessage = {
    type: typeof ServerMsgType.BuyTerraformDevicesResult;
    quantity: number;
    totalOnShip: number;
    credits: number;
};

export type StardockMenuMessage = {
    type: typeof ServerMsgType.StardockMenu;
};

export type TakeColonistsResultMessage = {
    type: typeof ServerMsgType.TakeColonistsResult;
    quantity: number;
    planetColonists: number;
    holdsUsed: number;
    holdsFree: number;
};

export type LeaveColonistsResultMessage = {
    type: typeof ServerMsgType.LeaveColonistsResult;
    quantity: number;
    planetColonists: number;
    holdsUsed: number;
    holdsFree: number;
};

// FighterEncounter embeds full sector display data (Oak's design) to avoid message ordering issues
export type FighterEncounterMessage = {
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

export type DeployFightersInfoMessage = {
    type: typeof ServerMsgType.DeployFightersInfo;
    sectorFighters: number;
    shipFighters: number;
    shipMaxFighters: number;
};

export type DeployFightersResultMessage = {
    type: typeof ServerMsgType.DeployFightersResult;
    sectorFighters: number;
    shipFighters: number;
};

export type SectorFighterCombatResultMessage = {
    type: typeof ServerMsgType.SectorFighterCombatResult;
    victory: boolean;
    fightersLost: number;
    sectorFightersRemaining: number;
    shipFighters: number;
};

export type RetreatResultMessage = {
    type: typeof ServerMsgType.RetreatResult;
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

export type ErrorMessage = {
    type: typeof ServerMsgType.Error;
    message: string;
};

export type ServerMessage =
    | WelcomeEvent
    | PlayerMovedEvent
    | SectorDisplayMessage
    | MoveResultObject
    | UndockResultObject
    | JettisonResultObject
    | LeavePlanetResultObject
    | LeaveStardockResultObject
    | PlayerLeftEvent
    | PlayersOnlineMessage
    | NoShipMessage
    | NonAdjacentMoveMessage
    | RateLimitedEvent
    | SectorWarpsMessage
    | PathResultMessage
    | PortInfoMessage
    | ShipInfoMessage
    | CargoInfoMessage
    | PortTransactionResultMessage
    | BuyFightersResultMessage
    | BuyShieldsResultMessage
    | BuyHoldsResultMessage
    | ShipExchangeResultMessage
    | AttackResultMessage
    | DockResultMessage
    | PlanetInfoMessage
    | TakeColonistsResultMessage
    | LeaveColonistsResultMessage
    | FighterEncounterMessage
    | DeployFightersInfoMessage
    | DeployFightersResultMessage
    | SectorFighterCombatResultMessage
    | RetreatResultMessage
    | SectorFightersAlertEvent
    | TerraformResultMessage
    | PlanetListMessage
    | LandOnPlanetResultMessage
    | PlanetDisplayResultMessage
    | DestroyPlanetResultMessage
    | BuyPlanetBustersResultMessage
    | BuyTerraformDevicesResultMessage
    | StardockMenuMessage
    | ErrorMessage;
