// Auth

export type AuthTokenPayload = {
    playerId: number;
    name?: string;
    role?: string;
    tokenVersion: number;
};

// WebSocket messages (server → client)

export type WelcomeMessage = {
    type: 'welcome';
    playerId: number;
    name: string;
    sector: number;
    token: string;
};

export type PlayerMovedMessage = {
    type: 'playerMoved';
    playerId: number;
    sector: number;
    direction: 'in' | 'out';
};

export type SectorDisplayMessage = {
    type: 'sectorDisplay';
    sector: number;
    players: number[];
    warps: number[];
};

export type PlayerLeftMessage = {
    type: 'playerLeft';
    playerId: number;
};

export type PlayersOnlineMessage = {
    type: 'playersOnline';
    players: number[];
};

export type NoShipMessage = {
    type: 'noShip';
};

export type NonAdjacentMoveMessage = {
    type: 'nonAdjacentMoveRequested';
    playerId: number;
    sector: number;
};

export type RateLimitedMessage = {
    type: 'rateLimited';
};

export type ServerMessage =
    | WelcomeMessage
    | PlayerMovedMessage
    | SectorDisplayMessage
    | PlayerLeftMessage
    | PlayersOnlineMessage
    | NoShipMessage
    | NonAdjacentMoveMessage
    | RateLimitedMessage;

// WebSocket messages (client → server)

export type MoveMessage = {
    type: 'move';
    sector: number;
};

export type DisplayMessage = {
    type: 'display';
};

export type WhoMessage = {
    type: 'who';
};

export type ClientMessage = MoveMessage | DisplayMessage | WhoMessage;

// HTTP API response shapes

export type SectorResponse = {
    id: number;
    warps: number[];
};

export type PlayersOnlineResponse = {
    players: { playerId: number; name: string }[];
};

export type RouteResponse = {
    path: number[];
    hops: number;
};

export type PortResponse = {
    sectorId: number;
    class: number;
    fuel: number;
    fuelPrice: number;
    organics: number;
    orgPrice: number;
    equipment: number;
    equPrice: number;
};

export type ShipResponse = {
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
    holdsAvailable: number;
};

export type CargoResponse = {
    playerId: number;
    fuel: number;
    organics: number;
    equipment: number;
    credits: number;
};

export type TradeResponse = {
    success: boolean;
    credits: number;
    cargo: { fuel: number; organics: number; equipment: number };
};

export type BuyResponse = {
    success: boolean;
    credits: number;
    fighters: number;
    shields: number;
    cargoLimit: number;
};

export type MoveResponse = {
    success: boolean;
    sector: number;
    warps: number[];
};

export type ShipExchangeResponse = {
    success: boolean;
    shipName: string;
    credits: number;
    maxFighters: number;
    maxShields: number;
    cargoLimit: number;
};

export type AuthResponse = {
    playerId: number;
    name: string;
    role: string;
    token: string;
};

export type LogoutResponse = {
    success: boolean;
};

export type ServerStatsResponse = {
    uptime: number;
    playersOnline: number;
    totalPlayers: number;
    totalSectors: number;
    nodeVersion: string;
    platform: string;
};
