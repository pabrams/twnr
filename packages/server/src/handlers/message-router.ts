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

/** A handler receives the player id and the typed command envelope. */
export type Handler<K extends ClientCommand['type']> = (
    playerId: number,
    data: ClientCommandByType[K],
) => void | Promise<void>;

type HandlerMap = { [K in ClientCommand['type']]: Handler<K> };

const handlers: HandlerMap = {
    [ClientMsgType.Move]: handleMove,
    [ClientMsgType.MoveToPrevious]: handleMoveToPrevious,
    [ClientMsgType.SectorDisplay]: handleSectorDisplay,
    [ClientMsgType.PlayersOnline]: handlePlayersOnline,
    [ClientMsgType.WarpsOut]: handleWarpsOut,
    [ClientMsgType.ShortestPath]: handleShortestPath,
    [ClientMsgType.PortInfo]: handlePortInfo,
    [ClientMsgType.ShipInfo]: handleShipInfo,
    [ClientMsgType.PortTransaction]: handlePortTransaction,
    [ClientMsgType.BuyDrones]: handleBuyDrones,
    [ClientMsgType.BuyShields]: handleBuyShields,
    [ClientMsgType.BuyHolds]: handleBuyHolds,
    [ClientMsgType.BuyShipTradein]: handleBuyShipTradein,
    [ClientMsgType.GetAttackTargets]: handleGetAttackTargets,
    [ClientMsgType.StarbaseInfo]: handleStarbaseInfo,
    [ClientMsgType.TerraformInfo]: handleTerraformInfo,
    [ClientMsgType.HardwareStoreInfo]: handleHardwareStoreInfo,
    [ClientMsgType.AttackShip]: handleAttackShip,
    [ClientMsgType.Dock]: handleDock,
    [ClientMsgType.Undock]: handleUndock,
    [ClientMsgType.Jettison]: handleJettison,
    [ClientMsgType.GetSectorPlanets]: handleGetSectorPlanets,
    [ClientMsgType.LandOnPlanet]: handleLandOnPlanet,
    [ClientMsgType.PlanetDisplay]: handlePlanetDisplay,
    [ClientMsgType.LeavePlanet]: handleLeavePlanet,
    [ClientMsgType.DestroyPlanet]: handleDestroyPlanet,
    [ClientMsgType.UseTerraformDevice]: handleUseTerraformDevice,
    [ClientMsgType.DockStarbase]: handleDockStarbase,
    [ClientMsgType.LeaveStarbase]: handleLeaveStarbase,
    [ClientMsgType.BuyHardware]: handleBuyHardware,
    [ClientMsgType.TakeColonists]: handleTakeColonists,
    [ClientMsgType.LeaveColonists]: handleLeaveColonists,
    [ClientMsgType.TakeCommodity]: handleTakeCommodity,
    [ClientMsgType.LeaveCommodity]: handleLeaveCommodity,
    [ClientMsgType.ListPlanets]: handleListPlanets,
    [ClientMsgType.ListOwnedShips]: handleListOwnedShips,
    [ClientMsgType.TransportToShip]: handleTransportToShip,
    [ClientMsgType.ClanCreate]: handleClanCreate,
    [ClientMsgType.ClanJoin]: handleClanJoin,
    [ClientMsgType.ClanLeave]: handleClanLeave,
    [ClientMsgType.ClanList]: handleClanList,
    [ClientMsgType.ClanInfo]: handleClanInfo,
    [ClientMsgType.ChangeShipOwnership]: handleChangeShipOwnership,
    [ClientMsgType.ClaimPlanet]: handleClaimPlanet,
    [ClientMsgType.ClanTransfer]: handleClanTransfer,
    [ClientMsgType.ClanMemo]: handleClanMemo,
    [ClientMsgType.ClanSetPassword]: handleClanSetPassword,
    [ClientMsgType.ClanDropMember]: handleClanDropMember,
    [ClientMsgType.DeployDronesInfo]: handleDeployDronesInfo,
    [ClientMsgType.DeployDrones]: handleDeployDrones,
    [ClientMsgType.AttackSectorDrones]: handleAttackSectorDrones,
    [ClientMsgType.RetreatFromDrones]: handleRetreatFromDrones,
    [ClientMsgType.BuyShipNew]: handleBuyShipNew,
    [ClientMsgType.ListDeployedDrones]: handleListDeployedDrones,
    [ClientMsgType.HyperspaceJump]: handleHyperspaceJump,
    [ClientMsgType.VisitedSectors]: handleVisitedSectors,
    [ClientMsgType.DeployMineInfo]: handleDeployMineInfo,
    [ClientMsgType.DeployMine]: handleDeployMine,
    [ClientMsgType.ListDeployedMines]: handleListDeployedMines,
    [ClientMsgType.TrackSeekerMines]: handleTrackSeekerMines,
    [ClientMsgType.MineDisruptor]: handleMineDisruptor,
    [ClientMsgType.GetNeighborhood]: handleGetNeighborhood,
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
