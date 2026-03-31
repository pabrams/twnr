// Message type constants

export const ServerMsgType = {
    Welcome: 'welcome',
    PlayerMoved: 'playerMoved',
    SectorDisplay: 'sectorDisplay',
    PlayerLeft: 'playerLeft',
    PlayersOnline: 'playersOnline',
    NoShip: 'noShip',
    NonAdjacentMoveRequested: 'nonAdjacentMoveRequested',
    RateLimited: 'rateLimited',
    SectorInfo: 'sectorInfo',
    PathResult: 'pathResult',
    PortInfo: 'portInfo',
    ShipInfo: 'shipInfo',
    CargoInfo: 'cargoInfo',
    TradeResult: 'tradeResult',
    BuyResult: 'buyResult',
    ShipExchangeResult: 'shipExchangeResult',
    Error: 'error',
} as const;

export const ClientMsgType = {
    Move: 'move',
    Display: 'display',
    Who: 'who',
    Sector: 'sector',
    Path: 'path',
    Port: 'port',
    Ship: 'ship',
    Cargo: 'cargo',
    Trade: 'trade',
    BuyFighters: 'buyFighters',
    BuyShields: 'buyShields',
    BuyHolds: 'buyHolds',
    ShipExchange: 'shipExchange',
} as const;

// Auth

export type AuthTokenPayload = {
    playerId: number;
    name?: string;
    role?: string;
    tokenVersion: number;
};

// WebSocket messages (server → client)

export type WelcomeMessage = {
    type: typeof ServerMsgType.Welcome;
    playerId: number;
    name: string;
    sector: number;
    token: string;
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
    players: number[];
    warps: number[];
};

export type PlayerLeftMessage = {
    type: typeof ServerMsgType.PlayerLeft;
    playerId: number;
};

export type PlayersOnlineMessage = {
    type: typeof ServerMsgType.PlayersOnline;
    players: number[];
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

export type SectorInfoMessage = {
    type: typeof ServerMsgType.SectorInfo;
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
    holdsAvailable: number;
};

export type CargoInfoMessage = {
    type: typeof ServerMsgType.CargoInfo;
    playerId: number;
    fuel: number;
    organics: number;
    equipment: number;
    credits: number;
};

export type TradeResultMessage = {
    type: typeof ServerMsgType.TradeResult;
    credits: number;
    cargo: { fuel: number; organics: number; equipment: number };
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
    type: typeof ClientMsgType.Move;
    sector: number;
};

export type DisplayMessage = {
    type: typeof ClientMsgType.Display;
};

export type WhoMessage = {
    type: typeof ClientMsgType.Who;
};

export type SectorQueryMessage = {
    type: typeof ClientMsgType.Sector;
    id: number;
};

export type PathQueryMessage = {
    type: typeof ClientMsgType.Path;
    from: number;
    to: number;
};

export type PortQueryMessage = {
    type: typeof ClientMsgType.Port;
    sectorId: number;
};

export type ShipQueryMessage = {
    type: typeof ClientMsgType.Ship;
};

export type CargoQueryMessage = {
    type: typeof ClientMsgType.Cargo;
};

export type TradeMessage = {
    type: typeof ClientMsgType.Trade;
    good: string;
    quantity: number;
    action: 'buy' | 'sell';
};

export type BuyFightersMessage = {
    type: typeof ClientMsgType.BuyFighters;
    quantity: number;
};

export type BuyShieldsMessage = {
    type: typeof ClientMsgType.BuyShields;
    quantity: number;
};

export type BuyHoldsMessage = {
    type: typeof ClientMsgType.BuyHolds;
    quantity: number;
};

export type ShipExchangeMessage = {
    type: typeof ClientMsgType.ShipExchange;
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
