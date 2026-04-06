import { WebSocket } from 'ws';
import { ClientMsgType, ServerMsgType } from '@twnr/shared';
import { players, send } from '../game-state.js';
import { handleMove, handleSectorDisplay, handleWarpsOut, handleShortestPath } from './movement.js';
import {
    handlePortInfo,
    handleDock,
    handleUndock,
    handlePortTransaction,
    handleDockStardock,
    handleLeaveStardock,
    handleBuyPlanetBusters,
    handleBuyTerraformDevices,
} from './port.js';
import { handleShipInfo, handleCargoInfo } from './ship-info.js';
import { handleBuyFighters, handleBuyShields, handleBuyHolds } from './ship-upgrades.js';
import { handleBuyShipTradein } from './ship-exchange.js';
import { handleJettison } from './ship-cargo.js';
import { handleAttackShip } from './combat.js';
import {
    handleLand,
    handleLandOnPlanet,
    handlePlanetDisplay,
    handleLeavePlanet,
    handleDestroyPlanet,
    handleUseTerraformDevice,
} from './planet.js';
import {
    handleDeployFightersInfo,
    handleDeployFighters,
    handleAttackSectorFighters,
    handleRetreatFromFighters,
} from './sector-fighters.js';
import {
    handleBuyHyperwarpDrive,
    handleListDeployedFighters,
    handleHyperspaceJump,
} from './hyperwarp.js';

export async function handleMessage(ws: WebSocket, playerId: number, data: any): Promise<void> {
    switch (data.type) {
        case ClientMsgType.Move:
            return handleMove(ws, playerId, data.sector);
        case ClientMsgType.SectorDisplay:
            return handleSectorDisplay(ws, playerId);
        case ClientMsgType.PlayersOnline:
            return handlePlayersOnline(ws, playerId);
        case ClientMsgType.WarpsOut:
            return handleWarpsOut(ws, playerId, data.id);
        case ClientMsgType.ShortestPath:
            return handleShortestPath(ws, playerId, data.from, data.to);
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
        case ClientMsgType.BuyShipTradein:
            return handleBuyShipTradein(ws, playerId, data.targetShipName);
        case ClientMsgType.AttackShip:
            return handleAttackShip(ws, playerId, data.targetPlayerId, data.fighters);
        case ClientMsgType.Dock:
            return handleDock(ws, playerId);
        case ClientMsgType.Undock:
            return handleUndock(ws, playerId);
        case ClientMsgType.Jettison:
            return handleJettison(ws, playerId);
        case ClientMsgType.Land:
            return handleLand(ws, playerId);
        case ClientMsgType.LandOnPlanet:
            return handleLandOnPlanet(ws, playerId, data.planetId);
        case ClientMsgType.PlanetDisplay:
            return handlePlanetDisplay(ws, playerId);
        case ClientMsgType.LeavePlanet:
            return handleLeavePlanet(ws, playerId);
        case ClientMsgType.DestroyPlanet:
            return handleDestroyPlanet(ws, playerId);
        case ClientMsgType.UseTerraformDevice:
            return handleUseTerraformDevice(ws, playerId);
        case ClientMsgType.DockStardock:
            return handleDockStardock(ws, playerId);
        case ClientMsgType.LeaveStardock:
            return handleLeaveStardock(ws, playerId);
        case ClientMsgType.BuyPlanetBusters:
            return handleBuyPlanetBusters(ws, playerId, data.quantity);
        case ClientMsgType.BuyTerraformDevices:
            return handleBuyTerraformDevices(ws, playerId, data.quantity);
        case ClientMsgType.TakeColonists:
        case ClientMsgType.LeaveColonists:
            send(ws, { type: ServerMsgType.Error, message: 'Not implemented' });
            return;
        case ClientMsgType.DeployFightersInfo:
            return handleDeployFightersInfo(ws, playerId);
        case ClientMsgType.DeployFighters:
            return handleDeployFighters(ws, playerId, data.quantity);
        case ClientMsgType.AttackSectorFighters:
            return handleAttackSectorFighters(ws, playerId, data.fighters);
        case ClientMsgType.RetreatFromFighters:
            return handleRetreatFromFighters(ws, playerId);
        case ClientMsgType.BuyHyperwarpDrive:
            return handleBuyHyperwarpDrive(ws, playerId);
        case ClientMsgType.ListDeployedFighters:
            return handleListDeployedFighters(ws, playerId);
        case ClientMsgType.HyperspaceJump:
            return handleHyperspaceJump(ws, playerId, data.targetSector);
        default:
            send(ws, { type: ServerMsgType.Error, message: 'Unknown message type' });
    }
}

function handlePlayersOnline(ws: WebSocket, playerId: number): void {
    const callerUniverse = players[playerId]?.universeId;
    const online = Object.entries(players)
        .filter(([, p]) => p.universeId === callerUniverse)
        .map(([id, p]) => ({ id: Number(id), name: p.name, sector: p.sector }));
    send(ws, { type: ServerMsgType.PlayersOnlineResult, players: online });
}
