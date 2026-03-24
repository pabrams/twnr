// Auth

export type AuthTokenPayload = {
  playerId: number;
  name?: string;
  role?: string;
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
};

export type SectorDisplayMessage = {
  type: 'sectorDisplay';
  sector: number;
  players: number[];
  warps: number[];
};

export type ServerMessage = WelcomeMessage | PlayerMovedMessage | SectorDisplayMessage;

// WebSocket messages (client → server)

export type MoveMessage = {
  type: 'move';
  sector: number;
};

export type DisplayMessage = {
  type: 'display';
};

export type ClientMessage = MoveMessage | DisplayMessage;

// HTTP API response shapes

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
