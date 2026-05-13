import { ClientTag, type ClientEnvelope } from '@twnr/shared';
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
    handleGetShipDetail,
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
import { handleReleaseBeacon, handleAttackBeacon } from './beacon.js';

type ClientCommandByType = { [C in ClientEnvelope as C['type']]: C };

/** A handler receives the player id and the typed command envelope. */
export type Handler<K extends ClientEnvelope['type']> = (
    playerId: number,
    data: ClientCommandByType[K],
) => void | Promise<void>;

type HandlerMap = { [K in ClientEnvelope['type']]: Handler<K> };

const handlers: HandlerMap = {
    [ClientTag.Move]: handleMove,
    [ClientTag.MoveToPrevious]: handleMoveToPrevious,
    [ClientTag.SectorDisplay]: handleSectorDisplay,
    [ClientTag.PlayersOnline]: handlePlayersOnline,
    [ClientTag.WarpsOut]: handleWarpsOut,
    [ClientTag.ShortestPath]: handleShortestPath,
    [ClientTag.PortInfo]: handlePortInfo,
    [ClientTag.ShipInfo]: handleShipInfo,
    [ClientTag.PortTransaction]: handlePortTransaction,
    [ClientTag.BuyDrones]: handleBuyDrones,
    [ClientTag.BuyShields]: handleBuyShields,
    [ClientTag.BuyHolds]: handleBuyHolds,
    [ClientTag.BuyShipTradein]: handleBuyShipTradein,
    [ClientTag.GetAttackTargets]: handleGetAttackTargets,
    [ClientTag.StarbaseInfo]: handleStarbaseInfo,
    [ClientTag.TerraformInfo]: handleTerraformInfo,
    [ClientTag.HardwareStoreInfo]: handleHardwareStoreInfo,
    [ClientTag.AttackShip]: handleAttackShip,
    [ClientTag.Dock]: handleDock,
    [ClientTag.Undock]: handleUndock,
    [ClientTag.Jettison]: handleJettison,
    [ClientTag.GetSectorPlanets]: handleGetSectorPlanets,
    [ClientTag.LandOnPlanet]: handleLandOnPlanet,
    [ClientTag.PlanetDisplay]: handlePlanetDisplay,
    [ClientTag.LeavePlanet]: handleLeavePlanet,
    [ClientTag.DestroyPlanet]: handleDestroyPlanet,
    [ClientTag.UseTerraformDevice]: handleUseTerraformDevice,
    [ClientTag.DockStarbase]: handleDockStarbase,
    [ClientTag.LeaveStarbase]: handleLeaveStarbase,
    [ClientTag.BuyHardware]: handleBuyHardware,
    [ClientTag.TakeColonists]: handleTakeColonists,
    [ClientTag.LeaveColonists]: handleLeaveColonists,
    [ClientTag.TakeCommodity]: handleTakeCommodity,
    [ClientTag.LeaveCommodity]: handleLeaveCommodity,
    [ClientTag.ListPlanets]: handleListPlanets,
    [ClientTag.ListOwnedShips]: handleListOwnedShips,
    [ClientTag.GetShipDetail]: handleGetShipDetail,
    [ClientTag.TransportToShip]: handleTransportToShip,
    [ClientTag.ClanCreate]: handleClanCreate,
    [ClientTag.ClanJoin]: handleClanJoin,
    [ClientTag.ClanLeave]: handleClanLeave,
    [ClientTag.ClanList]: handleClanList,
    [ClientTag.ClanInfo]: handleClanInfo,
    [ClientTag.ChangeShipOwnership]: handleChangeShipOwnership,
    [ClientTag.ClaimPlanet]: handleClaimPlanet,
    [ClientTag.ClanTransfer]: handleClanTransfer,
    [ClientTag.ClanMemo]: handleClanMemo,
    [ClientTag.ClanSetPassword]: handleClanSetPassword,
    [ClientTag.ClanDropMember]: handleClanDropMember,
    [ClientTag.DeployDronesInfo]: handleDeployDronesInfo,
    [ClientTag.DeployDrones]: handleDeployDrones,
    [ClientTag.AttackSectorDrones]: handleAttackSectorDrones,
    [ClientTag.RetreatFromDrones]: handleRetreatFromDrones,
    [ClientTag.BuyShipNew]: handleBuyShipNew,
    [ClientTag.ListDeployedDrones]: handleListDeployedDrones,
    [ClientTag.HyperspaceJump]: handleHyperspaceJump,
    [ClientTag.VisitedSectors]: handleVisitedSectors,
    [ClientTag.DeployMineInfo]: handleDeployMineInfo,
    [ClientTag.DeployMine]: handleDeployMine,
    [ClientTag.ListDeployedMines]: handleListDeployedMines,
    [ClientTag.TrackSeekerMines]: handleTrackSeekerMines,
    [ClientTag.MineDisruptor]: handleMineDisruptor,
    [ClientTag.GetNeighborhood]: handleGetNeighborhood,
    [ClientTag.ReleaseBeacon]: handleReleaseBeacon,
    [ClientTag.AttackBeacon]: handleAttackBeacon,
};

export async function handleMessage(playerId: number, data: ClientEnvelope): Promise<void> {
    const handler = handlers[data.type] as
        | ((pid: number, d: ClientEnvelope) => void | Promise<void>)
        | undefined;
    if (!handler) {
        sendError(playerId, 'Unknown message type');
        return;
    }
    await handler(playerId, data);
}
