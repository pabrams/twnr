// WebSocket messages (client → server)

import { ClientMsgType } from './messages.js';

export type MoveMessage = {
    type: typeof ClientMsgType.Move;
    sector: number;
};

export type DisplayMessage = {
    type: typeof ClientMsgType.SectorDisplay;
};

export type WhoMessage = {
    type: typeof ClientMsgType.Who;
};

export type SectorQueryMessage = {
    type: typeof ClientMsgType.SectorWarps;
    id: number;
};

export type PathQueryMessage = {
    type: typeof ClientMsgType.Path;
    from: number;
    to: number;
};

export type PortQueryMessage = {
    type: typeof ClientMsgType.PortInfo;
    sectorId: number;
};

export type ShipQueryMessage = {
    type: typeof ClientMsgType.ShipInfo;
};

export type CargoInfoQueryMessage = {
    type: typeof ClientMsgType.CargoInfo;
};

export type TradeMessage = {
    type: typeof ClientMsgType.PortTransaction;
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
export type AttackMessage = {
    type: typeof ClientMsgType.Attack;
    targetPlayerId: number;
    fighters: number;
};

export type DockMessage = {
    type: typeof ClientMsgType.Dock;
};

export type UndockMessage = {
    type: typeof ClientMsgType.Undock;
};

export type ClientMessage =
    | MoveMessage
    | DisplayMessage
    | WhoMessage
    | SectorQueryMessage
    | PathQueryMessage
    | PortQueryMessage
    | ShipQueryMessage
    | CargoInfoQueryMessage
    | TradeMessage
    | BuyFightersMessage
    | BuyShieldsMessage
    | BuyHoldsMessage
    | ShipExchangeMessage
    | AttackMessage
    | DockMessage
    | UndockMessage;
