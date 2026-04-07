import { ClientMsgType, ServerMsgType } from '@twnr/shared';
import { players, sendEnvelope } from '../game-state.js';
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

export async function handleMessage(playerId: number, data: any): Promise<void> {
    switch (data.type) {
        case ClientMsgType.Move:
            return handleMove(playerId, data.sector);
        case ClientMsgType.SectorDisplay:
            return handleSectorDisplay(playerId);
        case ClientMsgType.PlayersOnline:
            return handlePlayersOnline(playerId);
        case ClientMsgType.WarpsOut:
            return handleWarpsOut(playerId, data.id);
        case ClientMsgType.ShortestPath:
            return handleShortestPath(playerId, data.from, data.to);
        case ClientMsgType.PortInfo:
            return handlePortInfo(playerId, data.sectorId);
        case ClientMsgType.ShipInfo:
            return handleShipInfo(playerId);
        case ClientMsgType.CargoInfo:
            return handleCargoInfo(playerId);
        case ClientMsgType.PortTransaction:
            return handlePortTransaction(playerId, data.good, data.quantity, data.action);
        case ClientMsgType.BuyFighters:
            return handleBuyFighters(playerId, data.quantity);
        case ClientMsgType.BuyShields:
            return handleBuyShields(playerId, data.quantity);
        case ClientMsgType.BuyHolds:
            return handleBuyHolds(playerId, data.quantity);
        case ClientMsgType.BuyShipTradein:
            return handleBuyShipTradein(playerId, data.targetShipName);
        case ClientMsgType.AttackShip:
            return handleAttackShip(playerId, data.targetPlayerId, data.fighters);
        case ClientMsgType.Dock:
            return handleDock(playerId);
        case ClientMsgType.Undock:
            return handleUndock(playerId);
        case ClientMsgType.Jettison:
            return handleJettison(playerId);
        case ClientMsgType.Land:
            return handleLand(playerId);
        case ClientMsgType.LandOnPlanet:
            return handleLandOnPlanet(playerId, data.planetId);
        case ClientMsgType.PlanetDisplay:
            return handlePlanetDisplay(playerId);
        case ClientMsgType.LeavePlanet:
            return handleLeavePlanet(playerId);
        case ClientMsgType.DestroyPlanet:
            return handleDestroyPlanet(playerId);
        case ClientMsgType.UseTerraformDevice:
            return handleUseTerraformDevice(playerId);
        case ClientMsgType.DockStardock:
            return handleDockStardock(playerId);
        case ClientMsgType.LeaveStardock:
            return handleLeaveStardock(playerId);
        case ClientMsgType.BuyPlanetBusters:
            return handleBuyPlanetBusters(playerId, data.quantity);
        case ClientMsgType.BuyTerraformDevices:
            return handleBuyTerraformDevices(playerId, data.quantity);
        case ClientMsgType.TakeColonists:
        case ClientMsgType.LeaveColonists:
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not implemented' });
            return;
        case ClientMsgType.DeployFightersInfo:
            return handleDeployFightersInfo(playerId);
        case ClientMsgType.DeployFighters:
            return handleDeployFighters(playerId, data.quantity);
        case ClientMsgType.AttackSectorFighters:
            return handleAttackSectorFighters(playerId, data.fighters);
        case ClientMsgType.RetreatFromFighters:
            return handleRetreatFromFighters(playerId);
        case ClientMsgType.BuyHyperwarpDrive:
            return handleBuyHyperwarpDrive(playerId);
        case ClientMsgType.ListDeployedFighters:
            return handleListDeployedFighters(playerId);
        case ClientMsgType.HyperspaceJump:
            return handleHyperspaceJump(playerId, data.targetSector);
        default:
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Unknown message type' });
    }
}

function handlePlayersOnline(playerId: number): void {
    const callerUniverse = players[playerId]?.universeId;
    const online = Object.entries(players)
        .filter(([, p]) => p.universeId === callerUniverse)
        .map(([id, p]) => ({ id: Number(id), name: p.name, sector: p.sector }));
    sendEnvelope(playerId, { type: ServerMsgType.PlayersOnlineResult, players: online });
}
