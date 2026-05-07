import { ClientMsgType } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { NOTIFY, PANEL } from '../messages/index.js';
import { type DisplayCtx } from '../display.js';
import { type DisplayPortCtx } from '../display-port.js';
import { type DisplayStarbaseCtx } from '../display-starbase.js';
import { type DisplayComputerCtx } from '../display-computer.js';
import type { Handler } from './index.js';
import { fmt, formatDuration, refreshMinimap, type RefreshMinimapDeps } from './utils.js';

type LifecycleDeps = Pick<
    GameContext,
    'autopilot' | 'io' | 'minimap' | 'player' | 'ship' | 'world'
> &
    DisplayCtx &
    DisplayPortCtx &
    DisplayStarbaseCtx &
    DisplayComputerCtx &
    RefreshMinimapDeps;

export const welcome: Handler<'welcome', LifecycleDeps> = (ctx, msg) => {
    ctx.player.name = msg.name;
    ctx.player.id = msg.playerId;
    ctx.world.totalSectors = msg.totalSectors;
    ctx.ship.currentShipName = msg.shipName;
    ctx.ship.currentColoredShipName = msg.coloredShipName;
    ctx.world.starbaseSector = msg.starbaseSector;
    ctx.player.isAdmin = msg.isAdmin;
    ctx.player.isGuest = !!msg.isGuest;
    if (msg.isAdmin) ctx.minimap.handle?.setAdminMode(true);
    ctx.io.term.writeln(render(NOTIFY.welcome, { name: msg.name }));
    if (msg.isGuest) {
        ctx.io.term.writeln(render(NOTIFY.welcomeGuest));
    }
    ctx.io.sendMsg({ type: ClientMsgType.SectorDisplay });
    refreshMinimap(ctx);
};

export const playerMoved: Handler<'playerMoved', LifecycleDeps> = (ctx, msg) => {
    ctx.io.term.writeln(
        render(msg.direction === 'in' ? NOTIFY.playerIn : NOTIFY.playerOut, {
            name: msg.playerName,
        }),
    );
};

export const rateLimited: Handler<'rateLimited', LifecycleDeps> = (ctx) => {
    if (ctx.autopilot.path.length > 0) {
        const retrySector = ctx.autopilot.path[ctx.autopilot.step - 1];
        if (retrySector !== undefined) {
            setTimeout(() => {
                ctx.io.sendMsg({ type: ClientMsgType.Move, sector: retrySector });
            }, 200);
        }
    }
};

export const playersOnline: Handler<'playersOnlineResult', LifecycleDeps> = (ctx, msg) => {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(PANEL.playersOnlineHeader, { count: msg.players.length }));
    for (const p of msg.players) {
        const suffix = p.id === ctx.player.id ? render(PANEL.playersOnlineYouTag) : '';
        ctx.io.term.writeln(render(PANEL.playersOnlineRow, { name: p.name, suffix }));
    }
};

export const neighborhood: Handler<'neighborhoodResult', LifecycleDeps> = (ctx, msg) => {
    ctx.minimap.handle?.update(msg, ctx.world.currentSector);
};

export const starbaseInfo: Handler<'starbaseInfoResult', LifecycleDeps> = (ctx, msg) => {
    ctx.world.starbaseSector = msg.sector;
    if (msg.sector != null) {
        ctx.io.term.writeln(render(NOTIFY.starbaseLocation, { sector: msg.sector }));
    } else {
        ctx.io.term.writeln(render(NOTIFY.noStarbase));
    }
    ctx.io.term.writeln(render(NOTIFY.universeStatsHeader, { name: msg.universeName }));
    const createdDate = (() => {
        try {
            return new Date(msg.createdAt).toLocaleString();
        } catch {
            return msg.createdAt;
        }
    })();
    ctx.io.term.writeln(
        render(NOTIFY.universeStatsCreated, { date: createdDate, days: msg.daysElapsed }),
    );
    ctx.io.term.writeln(
        render(NOTIFY.universeStatsLine, {
            label: 'Sectors           ',
            value: fmt(msg.sectorCount),
        }),
    );
    ctx.io.term.writeln(
        render(NOTIFY.universeStatsLine, {
            label: 'Ports at creation ',
            value: fmt(msg.portCount),
        }),
    );
    ctx.io.term.writeln(
        render(NOTIFY.universeStatsLine, {
            label: 'Max planets/sector',
            value: fmt(msg.maxPlanetsPerSector),
        }),
    );
    ctx.io.term.writeln(
        render(NOTIFY.universeStatsLine, {
            label: 'Starting credits  ',
            value: fmt(msg.startingCredits),
        }),
    );
    ctx.io.term.writeln(
        render(NOTIFY.universeStatsLine, {
            label: 'Starting turns    ',
            value: fmt(msg.startingTurns),
        }),
    );
    ctx.io.term.writeln(
        render(NOTIFY.universeStatsLine, {
            label: 'Starting drones   ',
            value: fmt(msg.startingDrones),
        }),
    );
    ctx.io.term.writeln(
        render(NOTIFY.universeStatsLine, {
            label: 'Starting holds    ',
            value: fmt(msg.startingHolds),
        }),
    );
    if (msg.respawnDelaySeconds <= 0) {
        ctx.io.term.writeln(render(NOTIFY.universeStatsRespawnNone));
    } else {
        ctx.io.term.writeln(
            render(NOTIFY.universeStatsRespawnSeconds, {
                value: formatDuration(msg.respawnDelaySeconds),
            }),
        );
    }
    ctx.io.term.writeln(render(NOTIFY.universeStatsDegHeader));
    for (let deg = 1; deg <= 6; deg++) {
        const count = msg.outWarpDistribution[deg] ?? 0;
        if (count === 0) continue;
        ctx.io.term.writeln(
            render(NOTIFY.universeStatsDegRow, {
                degree: deg,
                s: deg === 1 ? '' : 's',
                count: fmt(count),
                ss: count === 1 ? '' : 's',
            }),
        );
    }
};

export const error: Handler<'error', LifecycleDeps> = (ctx, msg) => {
    ctx.io.term.writeln(render(NOTIFY.error, { message: msg.message }));
    // The framework re-renders the active menu's prompt after this handler.
    // Qty/confirm sub-menus are gone; the inline askNumber/askConfirm flows
    // already leave the player at the parent menu by the time an error lands.
};
