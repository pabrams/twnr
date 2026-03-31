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

export type SectorInfoMessage = {
    type: 'sectorInfo';
    id: number;
    warps: number[];
};

export type PathResultMessage = {
    type: 'pathResult';
    path: number[];
    hops: number;
};

export type PortInfoMessage = {
    type: 'portInfo';
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
    type: 'shipInfo';
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

export type CargoInfoMessage = {
    type: 'cargoInfo';
    playerId: number;
    fuel: number;
    organics: number;
    equipment: number;
    credits: number;
};

export type TradeResultMessage = {
    type: 'tradeResult';
    credits: number;
    cargo: { fuel: number; organics: number; equipment: number };
};

export type BuyResultMessage = {
    type: 'buyResult';
    credits: number;
    fighters: number;
    shields: number;
    cargoLimit: number;
};

export type ShipExchangeResultMessage = {
    type: 'shipExchangeResult';
    shipName: string;
    credits: number;
    maxFighters: number;
    maxShields: number;
    cargoLimit: number;
};

export type ErrorMessage = {
    type: 'error';
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
    | SectorInfoMessage
    | PathResultMessage
    | PortInfoMessage
    | ShipInfoMessage
    | CargoInfoMessage
    | TradeResultMessage
    | BuyResultMessage
    | ShipExchangeResultMessage
    | ErrorMessage;

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

export type SectorQueryMessage = {
    type: 'sector';
    id: number;
};

export type PathQueryMessage = {
    type: 'path';
    from: number;
    to: number;
};

export type PortQueryMessage = {
    type: 'port';
    sectorId: number;
};

export type ShipQueryMessage = {
    type: 'ship';
};

export type CargoQueryMessage = {
    type: 'cargo';
};

export type TradeMessage = {
    type: 'trade';
    good: string;
    quantity: number;
    action: 'buy' | 'sell';
};

export type BuyFightersMessage = {
    type: 'buyFighters';
    quantity: number;
};

export type BuyShieldsMessage = {
    type: 'buyShields';
    quantity: number;
};

export type BuyHoldsMessage = {
    type: 'buyHolds';
    quantity: number;
};

export type ShipExchangeMessage = {
    type: 'shipExchange';
    targetShipName: string;
};

export type ClientMessage =
    | MoveMessage
    | DisplayMessage
    | WhoMessage
    | SectorQueryMessage
    | PathQueryMessage
    | PortQueryMessage
    | ShipQueryMessage
    | CargoQueryMessage
    | TradeMessage
    | BuyFightersMessage
    | BuyShieldsMessage
    | BuyHoldsMessage
    | ShipExchangeMessage;

// HTTP API response shapes (auth & admin only)

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
