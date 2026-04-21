import { ClientMsgType, ServerMsgType, type ClientCommand } from '@twnr/shared';
import { players, sendEnvelope, sendError, getVisitedSectors } from '../game-state.js';
import { countSectorsInUniverse } from '../db/queries/sector.js';
import { handleChangeMenu } from './menu.js';
import {
    handleMove,
    handleMoveToPrevious,
    handleSectorDisplay,
    handleWarpsOut,
    handleShortestPath,
} from './movement.js';
import {
    handlePortInfo,
    handleDock,
    handleUndock,
    handlePortTransaction,
    handleTradeResponse,
    handleTradeConfirmResponse,
    handleDockStarbase,
    handleLeaveStarbase,
} from './port.js';
import { handleShipInfo } from './ship-info.js';
import { handleStarbaseInfo } from './starbase-info.js';
import { handleBuyDrones, handleBuyShields, handleBuyHolds } from './ship-upgrades.js';
import { handleBuyShipTradein, handleBuyShipNew } from './ship-exchange.js';
import { handleJettison } from './ship-cargo.js';
import { handleAttack, handleAttackShip } from './combat.js';
import {
    handleLand,
    handleLandOnPlanet,
    handlePlanetDisplay,
    handleLeavePlanet,
    handleDestroyPlanet,
    handleUseTerraformDevice,
    handleTakeColonists,
    handleLeaveColonists,
    handleListPlanets,
} from './planet.js';
import {
    handleDeployDronesInfo,
    handleDeployDrones,
    handleAttackSectorDrones,
    handleRetreatFromDrones,
} from './sector-drones.js';
import { handleListDeployedDrones, handleHyperspaceJump } from './hyperwarp.js';
import { handleBuyHardware } from './hardware-store.js';

export async function handleMessage(playerId: number, data: ClientCommand): Promise<void> {
    switch (data.type) {
        case ClientMsgType.Move:
            return handleMove(playerId, data.sector);
        case ClientMsgType.MoveToPrevious:
            return handleMoveToPrevious(playerId);
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
        case ClientMsgType.Attack:
            return handleAttack(playerId);
        case ClientMsgType.StarbaseInfo:
            return handleStarbaseInfo(playerId);
        case ClientMsgType.AttackShip:
            return handleAttackShip(playerId, data.targetPlayerId, data.drones);
        case ClientMsgType.Dock:
            return handleDock(playerId);
        case ClientMsgType.Undock:
            return handleUndock(playerId);
        case ClientMsgType.TradeResponse:
            return handleTradeResponse(playerId, data.quantity);
        case ClientMsgType.TradeConfirmResponse:
            return handleTradeConfirmResponse(playerId, data.confirmed);
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
        case ClientMsgType.DockStarbase:
            return handleDockStarbase(playerId);
        case ClientMsgType.LeaveStarbase:
            return handleLeaveStarbase(playerId);
        case ClientMsgType.BuyHardware:
            return handleBuyHardware(playerId, data.itemName, data.quantity);
        case ClientMsgType.TakeColonists:
            return handleTakeColonists(playerId, data.quantity, data.commodity ?? 'fuel');
        case ClientMsgType.LeaveColonists:
            return handleLeaveColonists(playerId, data.quantity, data.commodity ?? 'fuel');
        case ClientMsgType.ListPlanets:
            return handleListPlanets(playerId);
        case ClientMsgType.DeployDronesInfo:
            return handleDeployDronesInfo(playerId);
        case ClientMsgType.DeployDrones:
            return handleDeployDrones(playerId, data.quantity);
        case ClientMsgType.AttackSectorDrones:
            return handleAttackSectorDrones(playerId, data.drones);
        case ClientMsgType.RetreatFromDrones:
            return handleRetreatFromDrones(playerId);
        case ClientMsgType.BuyShipNew:
            return handleBuyShipNew(playerId, data.targetShipName);
        case ClientMsgType.ListDeployedDrones:
            return handleListDeployedDrones(playerId);
        case ClientMsgType.HyperspaceJump:
            return handleHyperspaceJump(playerId, data.targetSector);
        case ClientMsgType.ChangeMenu:
            return handleChangeMenu(playerId, data.menu);
        case ClientMsgType.VisitedSectors:
            return handleVisitedSectors(playerId);
        default:
            sendError(playerId, 'Unknown message type');
    }
}

async function handleVisitedSectors(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;
    const sectors = await getVisitedSectors(playerId);
    const totalSectors = await countSectorsInUniverse(player.universeId);
    sendEnvelope(playerId, {
        type: ServerMsgType.VisitedSectorsResult,
        sectors,
        totalSectors,
    });
}

function handlePlayersOnline(playerId: number): void {
    const callerUniverse = players[playerId]?.universeId;
    const online = Object.entries(players)
        .filter(([, p]) => p.universeId === callerUniverse)
        .map(([id, p]) => ({ id: Number(id), name: p.name }));
    sendEnvelope(playerId, { type: ServerMsgType.PlayersOnlineResult, players: online });
}
