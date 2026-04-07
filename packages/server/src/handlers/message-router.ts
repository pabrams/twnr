import { ClientMsgType, ServerMsgType } from '@twnr/shared';
import { players, sendEnvelope } from '../game-state.js';
import { handleChangeMenu } from './menu.js';
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
import { handleBuyDrones, handleBuyShields, handleBuyHolds } from './ship-upgrades.js';
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
    handleDeployDronesInfo,
    handleDeployDrones,
    handleAttackSectorDrones,
    handleRetreatFromDrones,
} from './sector-drones.js';
import {
    handleBuyHyperwarpDrive,
    handleListDeployedDrones,
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
        case ClientMsgType.BuyDrones:
            return handleBuyDrones(playerId, data.quantity);
        case ClientMsgType.BuyShields:
            return handleBuyShields(playerId, data.quantity);
        case ClientMsgType.BuyHolds:
            return handleBuyHolds(playerId, data.quantity);
        case ClientMsgType.BuyShipTradein:
            return handleBuyShipTradein(playerId, data.targetShipName);
        case ClientMsgType.AttackShip:
            return handleAttackShip(playerId, data.targetPlayerId, data.drones);
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
        case ClientMsgType.DeployDronesInfo:
            return handleDeployDronesInfo(playerId);
        case ClientMsgType.DeployDrones:
            return handleDeployDrones(playerId, data.quantity);
        case ClientMsgType.AttackSectorDrones:
            return handleAttackSectorDrones(playerId, data.drones);
        case ClientMsgType.RetreatFromDrones:
            return handleRetreatFromDrones(playerId);
        case ClientMsgType.BuyHyperwarpDrive:
            return handleBuyHyperwarpDrive(playerId);
        case ClientMsgType.ListDeployedDrones:
            return handleListDeployedDrones(playerId);
        case ClientMsgType.HyperspaceJump:
            return handleHyperspaceJump(playerId, data.targetSector);
        case ClientMsgType.ChangeMenu:
            return handleChangeMenu(playerId, data.menu);
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
