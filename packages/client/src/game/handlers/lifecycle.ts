import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { NOTIFY, PANEL } from '../messages/index.js';
import { showPrompt } from '../display.js';
import { showClass0Menu } from '../display-port.js';
import { showShipyardsMenu, showHardwareMenu } from '../display-starbase.js';
import { renderVisitedSectorsResult } from '../display-computer.js';
import type { Handler } from './index.js';
import { fmt, formatDuration, refreshMinimap } from './utils.js';

export const welcome: Handler<'welcome'> = (ctx, msg) => {
    ctx.playerName = msg.name;
    ctx.playerId = msg.playerId;
    ctx.totalSectors = msg.totalSectors;
    ctx.currentShipName = msg.shipName;
    ctx.currentColoredShipName = msg.coloredShipName;
    ctx.starbaseSector = msg.starbaseSector;
    ctx.isAdmin = msg.isAdmin;
    if (msg.isAdmin) ctx.minimap?.setAdminMode(true);
    ctx.term.writeln(render(NOTIFY.welcome, { name: msg.name }));
    if (msg.isGuest) {
        ctx.term.writeln(render(NOTIFY.welcomeGuest));
    }
    ctx.sendMsg({ type: ClientMsgType.SectorDisplay });
    refreshMinimap(ctx);
};

export const playerMoved: Handler<'playerMoved'> = (ctx, msg) => {
    ctx.term.writeln(
        render(msg.direction === 'in' ? NOTIFY.playerIn : NOTIFY.playerOut, {
            name: msg.playerName,
        }),
    );
};

export const rateLimited: Handler<'rateLimited'> = (ctx) => {
    if (ctx.autopilotPath.length > 0) {
        const retrySector = ctx.autopilotPath[ctx.autopilotStep - 1];
        if (retrySector !== undefined) {
            setTimeout(() => {
                ctx.sendMsg({ type: ClientMsgType.Move, sector: retrySector });
            }, 200);
        }
    }
};

export const playersOnline: Handler<'playersOnlineResult'> = (ctx, msg) => {
    ctx.term.writeln('');
    ctx.term.writeln(render(PANEL.playersOnlineHeader, { count: msg.players.length }));
    for (const p of msg.players) {
        const suffix = p.id === ctx.playerId ? render(PANEL.playersOnlineYouTag) : '';
        ctx.term.writeln(render(PANEL.playersOnlineRow, { name: p.name, suffix }));
    }
    showPrompt(ctx);
};

export const visitedSectors: Handler<'visitedSectorsResult'> = (ctx, msg) => {
    renderVisitedSectorsResult(ctx, msg);
};

export const neighborhood: Handler<'neighborhoodResult'> = (ctx, msg) => {
    ctx.minimap?.update(msg, ctx.currentSector);
};

export const starbaseInfo: Handler<'starbaseInfoResult'> = (ctx, msg) => {
    ctx.starbaseSector = msg.sector;
    if (msg.sector != null) {
        ctx.term.writeln(render(NOTIFY.starbaseLocation, { sector: msg.sector }));
    } else {
        ctx.term.writeln(render(NOTIFY.noStarbase));
    }
    ctx.term.writeln(render(NOTIFY.universeStatsHeader, { name: msg.universeName }));
    const createdDate = (() => {
        try {
            return new Date(msg.createdAt).toLocaleString();
        } catch {
            return msg.createdAt;
        }
    })();
    ctx.term.writeln(
        render(NOTIFY.universeStatsCreated, { date: createdDate, days: msg.daysElapsed }),
    );
    ctx.term.writeln(
        render(NOTIFY.universeStatsLine, {
            label: 'Sectors           ',
            value: fmt(msg.sectorCount),
        }),
    );
    ctx.term.writeln(
        render(NOTIFY.universeStatsLine, {
            label: 'Ports at creation ',
            value: fmt(msg.portCount),
        }),
    );
    ctx.term.writeln(
        render(NOTIFY.universeStatsLine, {
            label: 'Max planets/sector',
            value: fmt(msg.maxPlanetsPerSector),
        }),
    );
    ctx.term.writeln(
        render(NOTIFY.universeStatsLine, {
            label: 'Starting credits  ',
            value: fmt(msg.startingCredits),
        }),
    );
    ctx.term.writeln(
        render(NOTIFY.universeStatsLine, {
            label: 'Starting turns    ',
            value: fmt(msg.startingTurns),
        }),
    );
    ctx.term.writeln(
        render(NOTIFY.universeStatsLine, {
            label: 'Starting drones   ',
            value: fmt(msg.startingDrones),
        }),
    );
    ctx.term.writeln(
        render(NOTIFY.universeStatsLine, {
            label: 'Starting holds    ',
            value: fmt(msg.startingHolds),
        }),
    );
    if (msg.respawnDelaySeconds <= 0) {
        ctx.term.writeln(render(NOTIFY.universeStatsRespawnNone));
    } else {
        ctx.term.writeln(
            render(NOTIFY.universeStatsRespawnSeconds, {
                value: formatDuration(msg.respawnDelaySeconds),
            }),
        );
    }
    ctx.term.writeln(render(NOTIFY.universeStatsDegHeader));
    for (let deg = 1; deg <= 6; deg++) {
        const count = msg.outWarpDistribution[deg] ?? 0;
        if (count === 0) continue;
        ctx.term.writeln(
            render(NOTIFY.universeStatsDegRow, {
                degree: deg,
                s: deg === 1 ? '' : 's',
                count: fmt(count),
                ss: count === 1 ? '' : 's',
            }),
        );
    }
    showPrompt(ctx);
};

export const error: Handler<'error'> = (ctx, msg) => {
    ctx.term.writeln(render(NOTIFY.error, { message: msg.message }));
    if (ctx.mode === Menu.TradeQty || ctx.mode === Menu.TradeConfirm) {
        ctx.sendMsg({ type: ClientMsgType.Undock });
    } else if (ctx.mode === Menu.DeployDronesQty) {
        showPrompt(ctx);
    } else if (ctx.mode === Menu.DroneEncounter || ctx.mode === Menu.DroneAttackQty) {
        // stay in encounter mode
    } else if (ctx.mode === Menu.ShipyardsClass0Qty) {
        // Failed buy from the shipyards Class-0 menu — drop back to that
        // Class-0 menu (not all the way to Shipyards) so the user can pick
        // a different item.
        ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipyardsClass0 });
        showClass0Menu(ctx);
    } else if (ctx.mode === Menu.Class0Qty) {
        ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Class0 });
        showClass0Menu(ctx);
    } else if (ctx.mode.startsWith(Menu.Shipyards)) {
        showShipyardsMenu(ctx);
    } else if (ctx.mode === Menu.StarbaseHardware) {
        showHardwareMenu(ctx);
    } else if (ctx.mode === Menu.Sector) showPrompt(ctx);
};
