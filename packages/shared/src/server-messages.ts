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

export type SectorDisplayMessage = {
    type: typeof ServerMsgType.SectorDisplay;
    sector: number;
    players: { id: number; name: string }[];
    warps: number[];
    port?: { class: number; name: string } | null;
    visitedSectors: number[];
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

export type ColonistResultMessage = {
    type: typeof ServerMsgType.ColonistResult;
    action: 'take' | 'leave';
    quantity: number;
    planetColonists: number;
    holdsUsed: number;
    holdsFree: number;
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
    | ErrorMessage;
