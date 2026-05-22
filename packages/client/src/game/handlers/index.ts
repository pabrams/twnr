import { ServerTag } from '@twnr/shared';
import type { ServerEnvelope } from '@twnr/shared';
import type { GameContext } from '../types.js';

import * as lifecycle from './lifecycle.js';
import * as movement from './movement.js';
import * as sector from './sector.js';
import * as port from './port.js';
import * as hardwareStore from './hardware-store.js';
import * as combat from './combat.js';
import * as planet from './planet.js';
import * as shipExchange from './ship-exchange.js';
import * as mines from './mines.js';
import * as clan from './clan.js';
import * as drones from './drones.js';
import * as longRangeScan from './long-range-scan.js';
import * as tow from './tow.js';
import * as mail from './mail.js';

type ServerResultByType = {
    [R in ServerEnvelope as R['type']]: R;
};

/**
 * `Context` is the slice of `GameContext` the handler actually touches.
 */
export type Handler<K extends ServerEnvelope['type'], Context = GameContext> = (
    ctx: Context,
    msg: ServerResultByType[K],
) => void;

type HandlerMap = {
    [K in ServerEnvelope['type']]?: Handler<K>;
};

const handlers: HandlerMap = {
    [ServerTag.Welcome]: lifecycle.welcome,
    [ServerTag.PlayerMoved]: lifecycle.playerMoved,
    [ServerTag.RateLimited]: lifecycle.rateLimited,
    [ServerTag.PlayersOnlineResult]: lifecycle.playersOnline,
    [ServerTag.NeighborhoodResult]: lifecycle.neighborhood,
    [ServerTag.StarbaseInfoResult]: lifecycle.starbaseInfo,
    [ServerTag.Error]: lifecycle.error,

    [ServerTag.SectorDisplayResult]: sector.sectorDisplay,
    [ServerTag.MoveResult]: movement.move,
    [ServerTag.NonAdjacentMoveRequested]: movement.nonAdjacent,
    [ServerTag.ShortestPathResult]: movement.shortestPath,
    [ServerTag.HyperspaceJumpResult]: movement.hyperspaceJump,
    [ServerTag.PreviousSectorResult]: movement.previousSector,

    [ServerTag.DockResult]: port.dock,
    [ServerTag.UndockResult]: port.undock,
    [ServerTag.JettisonResult]: port.jettison,
    [ServerTag.DockStarbaseResult]: port.dockStarbase,
    [ServerTag.LeaveStarbaseResult]: port.leaveStarbase,

    [ServerTag.BuyDronesResult]: hardwareStore.buyDrones,
    [ServerTag.BuyShieldsResult]: hardwareStore.buyShields,
    [ServerTag.BuyHoldsResult]: hardwareStore.buyHolds,
    [ServerTag.BuyHardwareResult]: hardwareStore.buyHardware,
    [ServerTag.HardwareStoreInfoResult]: hardwareStore.hardwareStoreInfo,
    [ServerTag.ListDeployedDronesResult]: drones.listDeployedDrones,

    [ServerTag.AttackShipResult]: combat.attackShip,
    [ServerTag.GetAttackTargetsResult]: combat.getAttackTargets,
    [ServerTag.DeployDronesResult]: combat.deployDrones,
    [ServerTag.AttackSectorDronesResult]: combat.attackSectorDrones,
    [ServerTag.RetreatFromDronesResult]: combat.retreatFromDrones,
    [ServerTag.SectorDronesAlert]: combat.sectorDronesAlert,

    [ServerTag.PlanetInfoResult]: planet.planetInfo,
    [ServerTag.TakeColonistsResult]: planet.takeColonists,
    [ServerTag.LeaveColonistsResult]: planet.leaveColonists,
    [ServerTag.TakeCommodityResult]: planet.takeCommodity,
    [ServerTag.LeaveCommodityResult]: planet.leaveCommodity,
    [ServerTag.ChangePopulationResult]: planet.changePopulation,
    [ServerTag.LandOnPlanetResult]: planet.landOnPlanet,
    [ServerTag.PlanetDisplayResult]: planet.planetDisplay,
    [ServerTag.DestroyPlanetResult]: planet.destroyPlanet,
    [ServerTag.UseTerraformDeviceResult]: planet.useTerraformDevice,
    [ServerTag.LeavePlanetResult]: planet.leavePlanet,
    [ServerTag.ListPlanetsResult]: planet.listPlanets,
    [ServerTag.TerraformInfoResult]: planet.terraformInfo,

    [ServerTag.ShipInfoResult]: shipExchange.shipInfo,
    [ServerTag.BuyShipTradeinResult]: shipExchange.buyShipTradein,
    [ServerTag.BuyShipNewResult]: shipExchange.buyShipNew,

    [ServerTag.DeployMineResult]: mines.deployMine,
    [ServerTag.ListDeployedMinesResult]: mines.listDeployedMines,
    [ServerTag.TrackSeekerMinesResult]: mines.trackSeekerMines,
    [ServerTag.MineDisruptorResult]: mines.mineDisruptor,
    [ServerTag.ProximityMineHit]: mines.proximityMineHit,
    [ServerTag.SeekerMineAttached]: mines.seekerMineAttached,
    [ServerTag.SeekerMinePickupAlert]: mines.seekerMinePickupAlert,

    [ServerTag.MemoDelivery]: mail.memoDelivery,
    [ServerTag.ClanMemoNotification]: mail.clanMemoNotification,
    [ServerTag.HailIncoming]: mail.hailIncoming,
    [ServerTag.Notice]: mail.notice,
    [ServerTag.ClanMembershipChanged]: clan.clanMembershipChanged,

    [ServerTag.DensityScanResult]: longRangeScan.densityScan,
    [ServerTag.VisualScanResult]: longRangeScan.visualScan,

    [ServerTag.TowReleasedAlert]: tow.towReleasedAlert,
    [ServerTag.TowAttachedAlert]: tow.towAttachedAlert,

    [ServerTag.StatsSnapshot]: (ctx, msg) => {
        ctx.stats.handle?.update(msg);
    },
};

/** Returns the handler's result — `undefined` for sync handlers, a Promise
 *  for async ones. Callers (currently connection.ts) use this to attach a
 *  single "paint the menu prompt when fully done" callback on async chains
 *  so the prompt doesn't render mid-flow. */
export function dispatch(ctx: GameContext, msg: ServerEnvelope): void | Promise<void> {
    const handler = handlers[msg.type] as
        | ((ctx: GameContext, msg: ServerEnvelope) => void | Promise<void>)
        | undefined;
    return handler?.(ctx, msg);
}
