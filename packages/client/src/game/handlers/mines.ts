import type { GameContext } from '../types.js';
import type { ReplyHandler, EventHandler } from './index.js';
import { render } from '../renderer.js';
import { EVENT, PANEL } from '../messages/index.js';
import { refreshMinimap, type RefreshMinimapCtx } from './utils.js';

type MinesContext = Pick<GameContext, 'io' | 'minimap' | 'world'> & RefreshMinimapCtx;

export const deployMine: ReplyHandler<'DeployMine', MinesContext> = (ctx, msg) => {
    const label = msg.mineType === 'seeker' ? 'Limpet' : 'Proximity';
    ctx.io.term.writeln(
        render(EVENT.deployMineResult, {
            label,
            ship: msg.shipMines,
            sector: msg.sectorMines,
        }),
    );

    refreshMinimap(ctx);
};

export const listDeployedMines: ReplyHandler<'ListDeployedMines', MinesContext> = (ctx, msg) => {
    ctx.io.term.writeln('');
    const filter = ctx.world.mineScanFilter ?? null;
    const rows = filter ? msg.mines.filter((m) => m.mineType === filter) : msg.mines;
    if (rows.length === 0) {
        ctx.io.term.writeln(render(PANEL.deployedMinesEmpty));
        return;
    }
    const label = filter === 'seeker' ? 'Limpet' : filter === 'proximity' ? 'Proximity' : 'Mine';
    ctx.io.term.writeln(render(PANEL.deployedMinesTitle, { label }));
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(PANEL.deployedMinesColumns));
    ctx.io.term.writeln(render(PANEL.deployedMinesRule));
    let total = 0;
    for (const m of rows) {
        const kind =
            m.ownership.kind === 'player'
                ? 'Personal'
                : m.ownership.kind === 'clan'
                  ? 'Clan'
                  : 'Rogue';
        ctx.io.term.writeln(
            render(PANEL.deployedMinesRow, {
                sector: String(m.sectorNumber).padStart(6),
                qty: String(m.quantity).padStart(4),
                kind,
            }),
        );
        total += m.quantity;
    }
    ctx.io.term.writeln(render(PANEL.deployedMinesTotalsRow, { qty: String(total).padStart(4) }));
};

export const trackSeekerMines: ReplyHandler<'TrackSeekerMines', MinesContext> = (ctx, msg) => {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(PANEL.limpetScanTitle));
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(PANEL.limpetScanColumns));
    ctx.io.term.writeln(render(PANEL.limpetScanRule));
    for (const t of msg.targets) {
        const kind = t.ownership.kind === 'clan' ? `Clan #${t.ownership.clanNumber}` : 'Personal';
        ctx.io.term.writeln(
            render(PANEL.limpetScanRow, {
                sector: String(t.sectorNumber).padStart(6),
                kind,
            }),
        );
    }
    ctx.io.term.writeln(
        render(PANEL.limpetScanTotalsRow, { qty: String(msg.targets.length).padStart(4) }),
    );
};

export const mineDisruptor: ReplyHandler<'MineDisruptor', MinesContext> = (ctx, msg) => {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(
        render(EVENT.disruptorPulse, {
            sector: msg.targetSector,
            removed: msg.minesDisrupted,
            remaining: msg.proximityMinesRemaining,
        }),
    );
    refreshMinimap(ctx);
};

export const proximityMineHit: EventHandler<'ProximityMineHit', MinesContext> = (ctx, msg) => {
    ctx.io.term.writeln('');
    if (msg.destroyed) {
        ctx.io.term.writeln(
            render(EVENT.proximityHitDestroyed, {
                detonations: msg.detonations,
                damage: msg.damage,
            }),
        );
    } else {
        ctx.io.term.writeln(
            render(EVENT.proximityHit, {
                detonations: msg.detonations,
                damage: msg.damage,
                drones: msg.dronesLost,
                shields: msg.shieldsLost,
            }),
        );
    }
    refreshMinimap(ctx);
};

export const seekerMineAttached: EventHandler<'SeekerMineAttached', MinesContext> = (ctx) => {
    ctx.io.term.writeln(render(EVENT.seekerVictimNotice));
};

export const seekerMinePickedUp: EventHandler<'SeekerMinePickedUp', MinesContext> = (ctx, msg) => {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(
        render(EVENT.limpetLatched, { target: msg.targetOwnerName, sector: msg.sector }),
    );
};
