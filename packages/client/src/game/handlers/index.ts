import { Commands, Events } from '@twnr/shared';
import type {
    AcceptedReply,
    CommandName,
    CommandReply,
    EventName,
    EventPayload,
    Refusal,
    ServerEnvelope,
} from '@twnr/shared';
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

/** Renders an accepted reply; refusals are rendered centrally before dispatch. */
export type ReplyHandler<K extends CommandName, Context = GameContext> = (
    ctx: Context,
    msg: AcceptedReply<K>,
) => void;

export type EventHandler<K extends EventName, Context = GameContext> = (
    ctx: Context,
    msg: EventPayload<K>,
) => void;

/** Runs after a refusal has been rendered, for flows that must react to one (e.g. autopilot). */
export type RefusalHandler<K extends CommandName, Context = GameContext> = (
    ctx: Context,
    refusal: Extract<CommandReply<K>, { outcome: 'refused' }>,
) => void;

type Accepted<M> = Exclude<M, { outcome: 'refused' }>;

type HandlerMap = {
    [T in ServerEnvelope['type']]?: (
        ctx: GameContext,
        msg: Accepted<Extract<ServerEnvelope, { type: T }>>,
    ) => void | Promise<void>;
};

const handlers: HandlerMap = {
    [Events.Welcome.name]: lifecycle.welcome,
    [Events.PlayerMoved.name]: lifecycle.playerMoved,
    [Events.SectorActivity.name]: lifecycle.sectorActivity,
    [Events.RateLimited.name]: lifecycle.rateLimited,
    [Commands.PlayersOnline.reply.name]: lifecycle.playersOnline,
    [Commands.GetNeighborhood.reply.name]: lifecycle.neighborhood,
    [Commands.StarbaseInfo.reply.name]: lifecycle.starbaseInfo,
    [Events.ProtocolError.name]: lifecycle.protocolError,

    [Commands.SectorDisplay.reply.name]: sector.sectorDisplay,
    [Commands.Move.reply.name]: movement.move,
    [Commands.ShortestPath.reply.name]: movement.shortestPath,
    [Commands.HyperspaceJump.reply.name]: movement.hyperspaceJump,
    [Commands.MoveToPrevious.reply.name]: movement.previousSector,

    [Commands.Undock.reply.name]: port.undock,
    [Commands.Jettison.reply.name]: port.jettison,
    [Commands.DockStarbase.reply.name]: port.dockStarbase,
    [Commands.LeaveStarbase.reply.name]: port.leaveStarbase,

    [Commands.BuyDrones.reply.name]: hardwareStore.buyDrones,
    [Commands.BuyShields.reply.name]: hardwareStore.buyShields,
    [Commands.BuyHolds.reply.name]: hardwareStore.buyHolds,
    [Commands.BuyHardware.reply.name]: hardwareStore.buyHardware,
    [Commands.HardwareStoreInfo.reply.name]: hardwareStore.hardwareStoreInfo,
    [Commands.ListDeployedDrones.reply.name]: drones.listDeployedDrones,

    [Commands.AttackShip.reply.name]: combat.attackShip,
    [Commands.GetAttackTargets.reply.name]: combat.getAttackTargets,
    [Commands.DeployDrones.reply.name]: combat.deployDrones,
    [Commands.AttackSectorDrones.reply.name]: combat.attackSectorDrones,
    [Commands.RetreatFromDrones.reply.name]: combat.retreatFromDrones,
    [Events.SectorDronesAlert.name]: combat.sectorDronesAlert,

    [Commands.TakeColonists.reply.name]: planet.takeColonists,
    [Commands.LeaveColonists.reply.name]: planet.leaveColonists,
    [Commands.TakeCommodity.reply.name]: planet.takeCommodity,
    [Commands.LeaveCommodity.reply.name]: planet.leaveCommodity,
    [Commands.ChangePopulation.reply.name]: planet.changePopulation,
    [Commands.LandOnPlanet.reply.name]: planet.landOnPlanet,
    [Commands.PlanetDisplay.reply.name]: planet.planetDisplay,
    [Commands.DestroyPlanet.reply.name]: planet.destroyPlanet,
    [Events.PlanetDestroyedAlert.name]: planet.planetDestroyedAlert,
    [Commands.LeavePlanet.reply.name]: planet.leavePlanet,
    [Commands.ListPlanets.reply.name]: planet.listPlanets,

    [Commands.ShipInfo.reply.name]: shipExchange.shipInfo,
    [Commands.BuyShipTradein.reply.name]: shipExchange.buyShipTradein,
    [Commands.BuyShipNew.reply.name]: shipExchange.buyShipNew,

    [Commands.DeployMine.reply.name]: mines.deployMine,
    [Commands.ListDeployedMines.reply.name]: mines.listDeployedMines,
    [Commands.TrackSeekerMines.reply.name]: mines.trackSeekerMines,
    [Commands.MineDisruptor.reply.name]: mines.mineDisruptor,
    [Events.ProximityMineHit.name]: mines.proximityMineHit,
    [Events.SeekerMineAttached.name]: mines.seekerMineAttached,
    [Events.SeekerMinePickupAlert.name]: mines.seekerMinePickupAlert,

    [Events.MemoDelivery.name]: mail.memoDelivery,
    [Events.ClanMemoNotification.name]: mail.clanMemoNotification,
    [Events.HailIncoming.name]: mail.hailIncoming,
    [Events.Notice.name]: mail.notice,
    [Events.ClanMembershipChanged.name]: clan.clanMembershipChanged,

    [Commands.DensityScan.reply.name]: longRangeScan.densityScan,
    [Commands.VisualScan.reply.name]: longRangeScan.visualScan,

    [Events.TowReleasedAlert.name]: tow.towReleasedAlert,
    [Events.TowAttachedAlert.name]: tow.towAttachedAlert,

    [Events.StatsSnapshot.name]: (ctx, msg) => {
        ctx.ship.shipDrones = msg.ship.drones;
        ctx.ship.shipMaxDroneAttack = msg.ship.maxDroneAttack;
        ctx.stats.handle?.update(msg);
    },
};

const refusalHandlers: {
    [T in ServerEnvelope['type']]?: (
        ctx: GameContext,
        msg: Extract<ServerEnvelope, { type: T }> & Refusal,
    ) => void;
} = {
    [Commands.Move.reply.name]: movement.moveRefused,
};

export function dispatchRefusal(ctx: GameContext, msg: ServerEnvelope & Refusal): void {
    const handler = refusalHandlers[msg.type] as
        ((ctx: GameContext, msg: ServerEnvelope & Refusal) => void) | undefined;
    handler?.(ctx, msg);
}

export function dispatch(ctx: GameContext, msg: ServerEnvelope): void | Promise<void> {
    const handler = handlers[msg.type] as
        ((ctx: GameContext, msg: ServerEnvelope) => void | Promise<void>) | undefined;
    return handler?.(ctx, msg);
}
