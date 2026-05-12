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
import * as clan from './clan.js';

type ServerResultByType = {
    [R in ServerResult as R['type']]: R;
};

/**
 * `Context` is the slice of `GameContext` the handler actually touches.
 */
export type Handler<K extends ServerResult['type'], Context = GameContext> = (
    ctx: Context,
    msg: ServerResultByType[K],
) => void;

type HandlerMap = {
    [K in ServerResult['type']]?: Handler<K>;
};

const handlers: HandlerMap = {
    [ServerMsgType.Welcome]: lifecycle.welcome,
    [ServerMsgType.PlayerMoved]: lifecycle.playerMoved,
    [ServerMsgType.RateLimited]: lifecycle.rateLimited,
    [ServerMsgType.PlayersOnlineResult]: lifecycle.playersOnline,
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
    [ServerMsgType.UndockResult]: port.undock,
    [ServerMsgType.JettisonResult]: port.jettison,
    [ServerMsgType.DockStarbaseResult]: port.dockStarbase,
    [ServerMsgType.LeaveStarbaseResult]: port.leaveStarbase,

    [ServerMsgType.BuyDronesResult]: hardwareStore.buyDrones,
    [ServerMsgType.BuyShieldsResult]: hardwareStore.buyShields,
    [ServerMsgType.BuyHoldsResult]: hardwareStore.buyHolds,
    [ServerMsgType.BuyHardwareResult]: hardwareStore.buyHardware,
    [ServerMsgType.HardwareStoreInfoResult]: hardwareStore.hardwareStoreInfo,
    [ServerMsgType.ListDeployedDronesResult]: hardwareStore.listDeployedDrones,

    [ServerMsgType.AttackShipResult]: combat.attackShip,
    [ServerMsgType.GetAttackTargetsResult]: combat.getAttackTargets,
    [ServerMsgType.DeployDronesInfoResult]: combat.deployDronesInfo,
    [ServerMsgType.DeployDronesResult]: combat.deployDrones,
    [ServerMsgType.AttackSectorDronesResult]: combat.attackSectorDrones,
    [ServerMsgType.RetreatFromDronesResult]: combat.retreatFromDrones,
    [ServerMsgType.SectorDronesAlert]: combat.sectorDronesAlert,

    [ServerMsgType.PlanetInfoResult]: planet.planetInfo,
    [ServerMsgType.TakeColonistsResult]: planet.takeColonists,
    [ServerMsgType.LeaveColonistsResult]: planet.leaveColonists,
    [ServerMsgType.TakeCommodityResult]: planet.takeCommodity,
    [ServerMsgType.LeaveCommodityResult]: planet.leaveCommodity,
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

    [ServerMsgType.MemoDelivery]: clan.memoDelivery,
};

/** Returns the handler's result — `undefined` for sync handlers, a Promise
 *  for async ones. Callers (currently connection.ts) use this to attach a
 *  single "paint the menu prompt when fully done" callback on async chains
 *  so the prompt doesn't render mid-flow. */
export function dispatch(ctx: GameContext, msg: ServerResult): void | Promise<void> {
    const handler = handlers[msg.type] as
        | ((ctx: GameContext, msg: ServerResult) => void | Promise<void>)
        | undefined;
    return handler?.(ctx, msg);
}
