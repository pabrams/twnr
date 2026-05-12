import { ClientMsgType, type ClientCommand } from '@twnr/shared';
import { sendError } from '../state/messaging.js';
import { handleVisitedSectors } from './visited.js';
import { handlePlayersOnline } from './players.js';
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
    handleDockStarbase,
    handleLeaveStarbase,
} from './port.js';
import {
    handleShipInfo,
    handleListOwnedShips,
    handleTransportToShip,
    handleChangeShipOwnership,
} from './ship-info.js';
import { handleStarbaseInfo } from './starbase-info.js';
import { handleBuyDrones, handleBuyShields, handleBuyHolds } from './ship-upgrades.js';
import { handleBuyShipTradein, handleBuyShipNew } from './ship-exchange.js';
import { handleJettison } from './ship-cargo.js';
import { handleGetAttackTargets, handleAttackShip } from './combat.js';
import {
    handleGetSectorPlanets,
    handleLandOnPlanet,
    handlePlanetDisplay,
    handleLeavePlanet,
    handleDestroyPlanet,
    handleUseTerraformDevice,
    handleTerraformInfo,
    handleTakeColonists,
    handleLeaveColonists,
    handleTakeCommodity,
    handleLeaveCommodity,
    handleListPlanets,
    handleClaimPlanet,
} from './planet.js';
import {
    handleDeployDronesInfo,
    handleDeployDrones,
    handleAttackSectorDrones,
    handleRetreatFromDrones,
    handleListDeployedDrones,
} from './sector-drones.js';
import { handleHyperspaceJump } from './hyperwarp.js';
import { handleBuyHardware, handleHardwareStoreInfo } from './hardware-store.js';
import { handleGetNeighborhood } from './neighborhood.js';
import {
    handleDeployMine,
    handleDeployMineInfo,
    handleListDeployedMines,
    handleTrackSeekerMines,
    handleMineDisruptor,
} from './mines.js';
import {
    handleClanCreate,
    handleClanJoin,
    handleClanLeave,
    handleClanList,
    handleClanInfo,
    handleClanTransfer,
    handleClanMemo,
    handleClanSetPassword,
    handleClanDropMember,
} from './clan.js';

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
        case ClientMsgType.GetAttackTargets:
            return handleGetAttackTargets(playerId);
        case ClientMsgType.StarbaseInfo:
            return handleStarbaseInfo(playerId);
        case ClientMsgType.TerraformInfo:
            return handleTerraformInfo(playerId);
        case ClientMsgType.HardwareStoreInfo:
            return handleHardwareStoreInfo(playerId);
        case ClientMsgType.AttackShip:
            return handleAttackShip(playerId, data.targetPlayerId, data.drones);
        case ClientMsgType.Dock:
            return handleDock(playerId);
        case ClientMsgType.Undock:
            return handleUndock(playerId);
        case ClientMsgType.Jettison:
            return handleJettison(playerId);
        case ClientMsgType.GetSectorPlanets:
            return handleGetSectorPlanets(playerId);
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
        case ClientMsgType.TakeCommodity:
            return handleTakeCommodity(playerId, data.quantity, data.commodity ?? 'fuel');
        case ClientMsgType.LeaveCommodity:
            return handleLeaveCommodity(playerId, data.quantity, data.commodity ?? 'fuel');
        case ClientMsgType.ListPlanets:
            return handleListPlanets(playerId);
        case ClientMsgType.ListOwnedShips:
            return handleListOwnedShips(playerId);
        case ClientMsgType.TransportToShip:
            return handleTransportToShip(playerId, data.shipId);
        case ClientMsgType.ClanCreate:
            return handleClanCreate(playerId, data.name, data.password);
        case ClientMsgType.ClanJoin:
            return handleClanJoin(playerId, data.name, data.password);
        case ClientMsgType.ClanLeave:
            return handleClanLeave(playerId, data.successorPlayerId, data.confirmDissolve === true);
        case ClientMsgType.ClanList:
            return handleClanList(playerId);
        case ClientMsgType.ClanInfo:
            return handleClanInfo(playerId);
        case ClientMsgType.ChangeShipOwnership:
            return handleChangeShipOwnership(playerId, data.ownership);
        case ClientMsgType.ClaimPlanet:
            return handleClaimPlanet(playerId, data.ownership);
        case ClientMsgType.ClanTransfer:
            return handleClanTransfer(
                playerId,
                data.kind,
                data.targetPlayerId,
                data.quantity,
                data.mineType,
            );
        case ClientMsgType.ClanMemo:
            return handleClanMemo(playerId, data.body);
        case ClientMsgType.ClanSetPassword:
            return handleClanSetPassword(playerId, data.newPassword);
        case ClientMsgType.ClanDropMember:
            return handleClanDropMember(playerId, data.targetPlayerId);
        case ClientMsgType.DeployDronesInfo:
            return handleDeployDronesInfo(playerId);
        case ClientMsgType.DeployDrones:
            return handleDeployDrones(playerId, data.quantity, data.ownership ?? 'personal');
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
        case ClientMsgType.VisitedSectors:
            return handleVisitedSectors(playerId);
        case ClientMsgType.DeployMineInfo:
            return handleDeployMineInfo(playerId, data.mineType);
        case ClientMsgType.DeployMine:
            return handleDeployMine(
                playerId,
                data.mineType,
                data.quantity,
                data.ownership ?? 'personal',
            );
        case ClientMsgType.ListDeployedMines:
            return handleListDeployedMines(playerId);
        case ClientMsgType.TrackSeekerMines:
            return handleTrackSeekerMines(playerId);
        case ClientMsgType.MineDisruptor:
            return handleMineDisruptor(playerId, data.targetSector);
        case ClientMsgType.GetNeighborhood:
            return handleGetNeighborhood(
                playerId,
                data.halfWidthWorld,
                data.halfHeightWorld,
                data.centerXWorld,
                data.centerYWorld,
            );
        default:
            sendError(playerId, 'Unknown message type');
    }
}

