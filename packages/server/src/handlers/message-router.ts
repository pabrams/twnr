import { WebSocket } from 'ws';
import { ClientMsgType, ServerMsgType } from '@twnr/shared';
import { players, send } from '../game-state.js';
import { handleMove, handleSectorDisplay, handleSectorWarps, handlePath } from './movement.js';
import { handlePortInfo, handleDock, handleUndock, handlePortTransaction } from './port.js';
import {
    handleShipInfo,
    handleCargoInfo,
    handleBuyFighters,
    handleBuyShields,
    handleBuyHolds,
    handleShipExchange,
} from './ship.js';
import { handleAttack } from './combat.js';

export async function handleMessage(ws: WebSocket, playerId: number, data: any): Promise<void> {
    switch (data.type) {
        case ClientMsgType.Move:
            return handleMove(ws, playerId, data.sector);
        case ClientMsgType.SectorDisplay:
            return handleSectorDisplay(ws, playerId);
        case ClientMsgType.Who:
            return handleWho(ws);
        case ClientMsgType.SectorWarps:
            return handleSectorWarps(ws, playerId, data.id);
        case ClientMsgType.Path:
            return handlePath(ws, playerId, data.from, data.to);
        case ClientMsgType.PortInfo:
            return handlePortInfo(ws, playerId, data.sectorId);
        case ClientMsgType.ShipInfo:
            return handleShipInfo(ws, playerId);
        case ClientMsgType.CargoInfo:
            return handleCargoInfo(ws, playerId);
        case ClientMsgType.PortTransaction:
            return handlePortTransaction(ws, playerId, data.good, data.quantity, data.action);
        case ClientMsgType.BuyFighters:
            return handleBuyFighters(ws, playerId, data.quantity);
        case ClientMsgType.BuyShields:
            return handleBuyShields(ws, playerId, data.quantity);
        case ClientMsgType.BuyHolds:
            return handleBuyHolds(ws, playerId, data.quantity);
        case ClientMsgType.ShipExchange:
            return handleShipExchange(ws, playerId, data.targetShipName);
        case ClientMsgType.Attack:
            return handleAttack(ws, playerId, data.targetPlayerId, data.fighters);
        case ClientMsgType.Dock:
            return handleDock(ws, playerId);
        case ClientMsgType.Undock:
            return handleUndock(ws, playerId);
        default:
            send(ws, { type: ServerMsgType.Error, message: 'Unknown message type' });
    }
}

function handleWho(ws: WebSocket): void {
    const playersKeys = Object.keys(players).map(Number);
    send(ws, { type: ServerMsgType.PlayersOnline, players: playersKeys });
}
