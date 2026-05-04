import { ServerMsgType } from '@twnr/shared';
import type { ServerResult } from '@twnr/shared';
import type { GameContext } from '../types.js';

import * as lifecycle from './lifecycle.js';
import * as movement from './movement.js';
import * as port from './port.js';
import * as hardwareStore from './hardware-store.js';
import * as combat from './combat.js';
import * as planet from './planet.js';
import * as shipExchange from './ship-exchange.js';
import * as mines from './mines.js';

/**
 * `Deps` is the slice of `GameContext` the handler actually touches.
 * Defaults to the full `GameContext` for ergonomics, but each concrete
 * handler narrows it via `Pick` so signatures advertise their dependencies
 * (Interface Segregation). Function-parameter contravariance lets a handler
 * with narrower deps slot into the registry's broader `Handler<K>` type:
 * the registry passes a full `GameContext`, which structurally satisfies
 * any `Pick` of itself.
 */
export type Handler<K extends ServerResult['type'], Deps = GameContext> = (
    ctx: Deps,
    msg: Extract<ServerResult, { type: K }>,
) => void;

type HandlerMap = {
    [K in ServerResult['type']]?: Handler<K>;
};

const handlers: HandlerMap = {
    [ServerMsgType.Welcome]: lifecycle.welcome,
    [ServerMsgType.PlayerMoved]: lifecycle.playerMoved,
    [ServerMsgType.RateLimited]: lifecycle.rateLimited,
    [ServerMsgType.PlayersOnlineResult]: lifecycle.playersOnline,
    [ServerMsgType.VisitedSectorsResult]: lifecycle.visitedSectors,
    [ServerMsgType.NeighborhoodResult]: lifecycle.neighborhood,
    [ServerMsgType.StarbaseInfoResult]: lifecycle.starbaseInfo,
    [ServerMsgType.Error]: lifecycle.error,

    [ServerMsgType.SectorDisplayResult]: movement.sectorDisplay,
    [ServerMsgType.MoveResult]: movement.move,
    [ServerMsgType.NonAdjacentMoveRequested]: movement.nonAdjacent,
    [ServerMsgType.ShortestPathResult]: movement.shortestPath,
    [ServerMsgType.HyperspaceJumpResult]: movement.hyperspaceJump,
    [ServerMsgType.PreviousSectorResult]: movement.previousSector,

    [ServerMsgType.DockResult]: port.dock,
    [ServerMsgType.TradePrompt]: port.tradePrompt,
    [ServerMsgType.TradeConfirmPrompt]: port.tradeConfirmPrompt,
    [ServerMsgType.TradeComplete]: port.tradeComplete,
    [ServerMsgType.TradeSkipped]: port.tradeSkipped,
    [ServerMsgType.UndockResult]: port.undock,
    [ServerMsgType.JettisonResult]: port.jettison,
    [ServerMsgType.PortTransactionResult]: port.portTransaction,
    [ServerMsgType.DockStarbaseResult]: port.dockStarbase,
    [ServerMsgType.LeaveStarbaseResult]: port.leaveStarbase,

    [ServerMsgType.BuyDronesResult]: hardwareStore.buyDrones,
    [ServerMsgType.BuyShieldsResult]: hardwareStore.buyShields,
    [ServerMsgType.BuyHoldsResult]: hardwareStore.buyHolds,
    [ServerMsgType.BuyHardwareResult]: hardwareStore.buyHardware,
    [ServerMsgType.HardwareStoreInfoResult]: hardwareStore.hardwareStoreInfo,
    [ServerMsgType.ListDeployedDronesResult]: hardwareStore.listDeployedDrones,

    [ServerMsgType.AttackShipResult]: combat.attackShip,
    [ServerMsgType.AttackMenuResult]: combat.attackMenu,
    [ServerMsgType.DeployDronesInfoResult]: combat.deployDronesInfo,
    [ServerMsgType.DeployDronesResult]: combat.deployDrones,
    [ServerMsgType.AttackSectorDronesResult]: combat.attackSectorDrones,
    [ServerMsgType.RetreatFromDronesResult]: combat.retreatFromDrones,
    [ServerMsgType.SectorDronesAlert]: combat.sectorDronesAlert,

    [ServerMsgType.PlanetInfoResult]: planet.planetInfo,
    [ServerMsgType.TakeColonistsResult]: planet.takeColonists,
    [ServerMsgType.LeaveColonistsResult]: planet.leaveColonists,
    [ServerMsgType.LandResult]: planet.land,
    [ServerMsgType.LandOnPlanetResult]: planet.landOnPlanet,
    [ServerMsgType.PlanetDisplayResult]: planet.planetDisplay,
    [ServerMsgType.DestroyPlanetResult]: planet.destroyPlanet,
    [ServerMsgType.UseTerraformDeviceResult]: planet.useTerraformDevice,
    [ServerMsgType.LeavePlanetResult]: planet.leavePlanet,
    [ServerMsgType.ListPlanetsResult]: planet.listPlanets,
    [ServerMsgType.TerraformInfoResult]: planet.terraformInfo,

    [ServerMsgType.ShipInfoResult]: shipExchange.shipInfo,
    [ServerMsgType.BuyShipTradeinResult]: shipExchange.buyShipTradein,
    [ServerMsgType.BuyShipNewResult]: shipExchange.buyShipNew,

    [ServerMsgType.DeployMineResult]: mines.deployMine,
    [ServerMsgType.ListDeployedMinesResult]: mines.listDeployedMines,
    [ServerMsgType.TrackSeekerMinesResult]: mines.trackSeekerMines,
    [ServerMsgType.MineDisruptorResult]: mines.mineDisruptor,
    [ServerMsgType.ProximityMineHit]: mines.proximityMineHit,
    [ServerMsgType.SeekerMineAttached]: mines.seekerMineAttached,
    [ServerMsgType.SeekerMinePickupAlert]: mines.seekerMinePickupAlert,
};

export function dispatch(ctx: GameContext, msg: ServerResult): void {
    const handler = handlers[msg.type] as
        | ((ctx: GameContext, msg: ServerResult) => void)
        | undefined;
    handler?.(ctx, msg);
}
