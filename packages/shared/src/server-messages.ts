// WebSocket messages (server → client)

import { ServerMsgType } from './messages.js';

export type WelcomeMessage = {
    type: typeof ServerMsgType.Welcome;
    playerId: number;
    name: string;
    sector: number;
    token: string;
    totalSectors: number;
};

export type PlayerMovedMessage = {
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

export type SectorDisplayMessage = {
    type: typeof ServerMsgType.SectorDisplay;
    sector: number;
    players: { id: number; name: string }[];
    warps: number[];
    port?: { class: number; name: string } | null;
    visitedSectors: number[];
    sectorFighters?: SectorFighterInfo | null;
    planets: { id: number; name: string; type: string }[];
};

export type PlayerLeftMessage = {
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

export type RateLimitedMessage = {
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

export type portTransactionResultMessage = {
    type: typeof ServerMsgType.PortTransactionResult;
    credits: number;
    cargo: { fuel: number; organics: number; equipment: number; colonists: number };
};

export type BuyResultMessage = {
    type: typeof ServerMsgType.BuyResult;
    credits: number;
    fighters: number;
    shields: number;
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

export type PlanetDisplayResultMessage = {
    type: typeof ServerMsgType.PlanetDisplayResult;
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

export type DestroyPlanetResultMessage = {
    type: typeof ServerMsgType.DestroyPlanetResult;
    destroyed: boolean;
    planetId: number;
    planetName: string;
};

export type BuyHardwareResultMessage = {
    type: typeof ServerMsgType.BuyHardwareResult;
    item: string;
    quantity: number;
    totalOnShip: number;
    credits: number;
};

export type StardockMenuMessage = {
    type: typeof ServerMsgType.StardockMenu;
};

export type ColonistResultMessage = {
    type: typeof ServerMsgType.ColonistResult;
    action: 'take' | 'leave';
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

export type SectorFightersAlertMessage = {
    type: typeof ServerMsgType.SectorFightersAlert;
    event: 'intrusion' | 'attacked' | 'destroyed';
    sector: number;
    fightersLost: number;
    fightersRemaining: number;
    intruderName: string;
};

export type ErrorMessage = {
    type: typeof ServerMsgType.Error;
    message: string;
};

export type ServerMessage =
    | WelcomeMessage
    | PlayerMovedMessage
    | SectorDisplayMessage
    | PlayerLeftMessage
    | PlayersOnlineMessage
    | NoShipMessage
    | NonAdjacentMoveMessage
    | RateLimitedMessage
    | SectorWarpsMessage
    | PathResultMessage
    | PortInfoMessage
    | ShipInfoMessage
    | CargoInfoMessage
    | portTransactionResultMessage
    | BuyResultMessage
    | ShipExchangeResultMessage
    | AttackResultMessage
    | DockResultMessage
    | PlanetInfoMessage
    | ColonistResultMessage
    | FighterEncounterMessage
    | DeployFightersInfoMessage
    | DeployFightersResultMessage
    | SectorFighterCombatResultMessage
    | RetreatResultMessage
    | SectorFightersAlertMessage
    | TerraformResultMessage
    | PlanetListMessage
    | PlanetDisplayResultMessage
    | DestroyPlanetResultMessage
    | BuyHardwareResultMessage
    | StardockMenuMessage
    | ErrorMessage;
