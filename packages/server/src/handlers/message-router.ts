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

type ClientCommandByType = { [C in ClientCommand as C['type']]: C };

export type Handler<K extends ClientCommand['type']> = (
    playerId: number,
    data: ClientCommandByType[K],
) => void | Promise<void>;

type HandlerMap = { [K in ClientCommand['type']]: Handler<K> };

const handlers: HandlerMap = {
    [ClientMsgType.Move]: (pid, d) => handleMove(pid, d.sector),
    [ClientMsgType.MoveToPrevious]: (pid) => handleMoveToPrevious(pid),
    [ClientMsgType.SectorDisplay]: (pid) => handleSectorDisplay(pid),
    [ClientMsgType.PlayersOnline]: (pid) => handlePlayersOnline(pid),
    [ClientMsgType.WarpsOut]: (pid, d) => handleWarpsOut(pid, d.id),
    [ClientMsgType.ShortestPath]: (pid, d) => handleShortestPath(pid, d.from, d.to),
    [ClientMsgType.PortInfo]: (pid, d) => handlePortInfo(pid, d.sectorId),
    [ClientMsgType.ShipInfo]: (pid) => handleShipInfo(pid),
    [ClientMsgType.PortTransaction]: (pid, d) =>
        handlePortTransaction(pid, d.good, d.quantity, d.action),
    [ClientMsgType.BuyDrones]: (pid, d) => handleBuyDrones(pid, d.quantity),
    [ClientMsgType.BuyShields]: (pid, d) => handleBuyShields(pid, d.quantity),
    [ClientMsgType.BuyHolds]: (pid, d) => handleBuyHolds(pid, d.quantity),
    [ClientMsgType.BuyShipTradein]: (pid, d) => handleBuyShipTradein(pid, d.targetShipName),
    [ClientMsgType.GetAttackTargets]: (pid) => handleGetAttackTargets(pid),
    [ClientMsgType.StarbaseInfo]: (pid) => handleStarbaseInfo(pid),
    [ClientMsgType.TerraformInfo]: (pid) => handleTerraformInfo(pid),
    [ClientMsgType.HardwareStoreInfo]: (pid) => handleHardwareStoreInfo(pid),
    [ClientMsgType.AttackShip]: (pid, d) => handleAttackShip(pid, d.targetPlayerId, d.drones),
    [ClientMsgType.Dock]: (pid) => handleDock(pid),
    [ClientMsgType.Undock]: (pid) => handleUndock(pid),
    [ClientMsgType.Jettison]: (pid) => handleJettison(pid),
    [ClientMsgType.GetSectorPlanets]: (pid) => handleGetSectorPlanets(pid),
    [ClientMsgType.LandOnPlanet]: (pid, d) => handleLandOnPlanet(pid, d.planetId),
    [ClientMsgType.PlanetDisplay]: (pid) => handlePlanetDisplay(pid),
    [ClientMsgType.LeavePlanet]: (pid) => handleLeavePlanet(pid),
    [ClientMsgType.DestroyPlanet]: (pid) => handleDestroyPlanet(pid),
    [ClientMsgType.UseTerraformDevice]: (pid) => handleUseTerraformDevice(pid),
    [ClientMsgType.DockStarbase]: (pid) => handleDockStarbase(pid),
    [ClientMsgType.LeaveStarbase]: (pid) => handleLeaveStarbase(pid),
    [ClientMsgType.BuyHardware]: (pid, d) => handleBuyHardware(pid, d.itemName, d.quantity),
    [ClientMsgType.TakeColonists]: (pid, d) =>
        handleTakeColonists(pid, d.quantity, d.commodity ?? 'fuel'),
    [ClientMsgType.LeaveColonists]: (pid, d) =>
        handleLeaveColonists(pid, d.quantity, d.commodity ?? 'fuel'),
    [ClientMsgType.TakeCommodity]: (pid, d) =>
        handleTakeCommodity(pid, d.quantity, d.commodity ?? 'fuel'),
    [ClientMsgType.LeaveCommodity]: (pid, d) =>
        handleLeaveCommodity(pid, d.quantity, d.commodity ?? 'fuel'),
    [ClientMsgType.ListPlanets]: (pid) => handleListPlanets(pid),
    [ClientMsgType.ListOwnedShips]: (pid) => handleListOwnedShips(pid),
    [ClientMsgType.TransportToShip]: (pid, d) => handleTransportToShip(pid, d.shipId),
    [ClientMsgType.ClanCreate]: (pid, d) => handleClanCreate(pid, d.name, d.password),
    [ClientMsgType.ClanJoin]: (pid, d) => handleClanJoin(pid, d.name, d.password),
    [ClientMsgType.ClanLeave]: (pid, d) =>
        handleClanLeave(pid, d.successorPlayerId, d.confirmDissolve === true),
    [ClientMsgType.ClanList]: (pid) => handleClanList(pid),
    [ClientMsgType.ClanInfo]: (pid) => handleClanInfo(pid),
    [ClientMsgType.ChangeShipOwnership]: (pid, d) => handleChangeShipOwnership(pid, d.ownership),
    [ClientMsgType.ClaimPlanet]: (pid, d) => handleClaimPlanet(pid, d.ownership),
    [ClientMsgType.ClanTransfer]: (pid, d) =>
        handleClanTransfer(pid, d.kind, d.targetPlayerId, d.quantity, d.mineType),
    [ClientMsgType.ClanMemo]: (pid, d) => handleClanMemo(pid, d.body),
    [ClientMsgType.ClanSetPassword]: (pid, d) => handleClanSetPassword(pid, d.newPassword),
    [ClientMsgType.ClanDropMember]: (pid, d) => handleClanDropMember(pid, d.targetPlayerId),
    [ClientMsgType.DeployDronesInfo]: (pid) => handleDeployDronesInfo(pid),
    [ClientMsgType.DeployDrones]: (pid, d) =>
        handleDeployDrones(pid, d.quantity, d.ownership ?? 'personal'),
    [ClientMsgType.AttackSectorDrones]: (pid, d) => handleAttackSectorDrones(pid, d.drones),
    [ClientMsgType.RetreatFromDrones]: (pid) => handleRetreatFromDrones(pid),
    [ClientMsgType.BuyShipNew]: (pid, d) => handleBuyShipNew(pid, d.targetShipName),
    [ClientMsgType.ListDeployedDrones]: (pid) => handleListDeployedDrones(pid),
    [ClientMsgType.HyperspaceJump]: (pid, d) => handleHyperspaceJump(pid, d.targetSector),
    [ClientMsgType.VisitedSectors]: (pid) => handleVisitedSectors(pid),
    [ClientMsgType.DeployMineInfo]: (pid, d) => handleDeployMineInfo(pid, d.mineType),
    [ClientMsgType.DeployMine]: (pid, d) =>
        handleDeployMine(pid, d.mineType, d.quantity, d.ownership ?? 'personal'),
    [ClientMsgType.ListDeployedMines]: (pid) => handleListDeployedMines(pid),
    [ClientMsgType.TrackSeekerMines]: (pid) => handleTrackSeekerMines(pid),
    [ClientMsgType.MineDisruptor]: (pid, d) => handleMineDisruptor(pid, d.targetSector),
    [ClientMsgType.GetNeighborhood]: (pid, d) =>
        handleGetNeighborhood(
            pid,
            d.halfWidthWorld,
            d.halfHeightWorld,
            d.centerXWorld,
            d.centerYWorld,
        ),
};

export async function handleMessage(playerId: number, data: ClientCommand): Promise<void> {
    const handler = handlers[data.type] as
        | ((pid: number, d: ClientCommand) => void | Promise<void>)
        | undefined;
    if (!handler) {
        sendError(playerId, 'Unknown message type');
        return;
    }
    await handler(playerId, data);
}
