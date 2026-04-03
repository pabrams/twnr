import { WebSocket } from 'ws';
import { ClientMsgType, ServerMsgType } from '@twnr/shared';
import { players, send } from '../game-state.js';
import { handleMove, handleSectorDisplay, handleSectorWarps, handlePath } from './movement.js';
import { handlePortInfo, handleDock, handleUndock, handlePortTransaction } from './port.js';
import { handleShipInfo, handleCargoInfo } from './ship-info.js';
import { handleBuyFighters, handleBuyShields, handleBuyHolds } from './ship-upgrades.js';
import { handleShipExchange } from './ship-exchange.js';
import { handleJettison } from './ship-cargo.js';
import { handleAttack } from './combat.js';
import { handleLand, handleTakeColonists, handleLeaveColonists } from './planet.js';
import {
    handleDeployFightersInfo,
    handleDeployFighters,
    handleAttackSectorFighters,
    handleRetreatFromFighters,
} from './sector-fighters.js';

export async function handleMessage(ws: WebSocket, playerId: number, data: any): Promise<void> {
    switch (data.type) {
        case ClientMsgType.Move:
            return handleMove(ws, playerId, data.sector);
        case ClientMsgType.SectorDisplay:
            return handleSectorDisplay(ws, playerId);
        case ClientMsgType.Who:
            return handleWho(ws, playerId);
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
        case ClientMsgType.Jettison:
            return handleJettison(ws, playerId);
        case ClientMsgType.Land:
            return handleLand(ws, playerId);
        case ClientMsgType.TakeColonists:
            return handleTakeColonists(ws, playerId, data.quantity);
        case ClientMsgType.LeaveColonists:
            return handleLeaveColonists(ws, playerId, data.quantity);
        case ClientMsgType.DeployFightersInfo:
            return handleDeployFightersInfo(ws, playerId);
        case ClientMsgType.DeployFighters:
            return handleDeployFighters(ws, playerId, data.quantity);
        case ClientMsgType.AttackSectorFighters:
            return handleAttackSectorFighters(ws, playerId, data.fighters);
        case ClientMsgType.RetreatFromFighters:
            return handleRetreatFromFighters(ws, playerId);
        default:
            send(ws, { type: ServerMsgType.Error, message: 'Unknown message type' });
    }
}

function handleWho(ws: WebSocket, playerId: number): void {
    const callerUniverse = players[playerId]?.universeId;
    const online = Object.entries(players)
        .filter(([, p]) => p.universeId === callerUniverse)
        .map(([id, p]) => ({ id: Number(id), name: p.name, sector: p.sector }));
    send(ws, { type: ServerMsgType.PlayersOnline, players: online });
}
