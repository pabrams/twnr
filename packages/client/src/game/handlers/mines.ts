import type { GameContext } from '../types.js';
import type { Handler } from './index.js';
import { render } from '../renderer.js';
import { EVENT, PANEL } from '../messages/index.js';

type MinesContext = Pick<GameContext, 'io' | 'world'>;

export const deployMine: Handler<'deployMineResult', MinesContext> = (ctx, msg) => {
    const label = msg.mineType === 'seeker' ? 'Limpet' : 'Proximity';
    ctx.io.term.writeln(
        render(EVENT.deployMineResult, {
            label,
            ship: msg.shipMines,
            sector: msg.sectorMines,
        }),
    );
};

/** Render deployed-mines table, filtered by the type the user picked in
 *  the show-deployed-mines routine. The mineType filter is stashed on
 *  `ctx.world.mineScanFilter` by the routine before sending the request,
 *  so the handler knows which rows to keep. */
export const listDeployedMines: Handler<'listDeployedMinesResult', MinesContext> = (ctx, msg) => {
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

export const trackSeekerMines: Handler<'trackSeekerMinesResult', MinesContext> = (ctx, msg) => {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(PANEL.limpetScanTitle));
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(PANEL.limpetScanColumns));
    ctx.io.term.writeln(render(PANEL.limpetScanRule));
    // Each target row has owner info via the existing fields. For now we
    // render `Personal` for every attached limpet (since track only
    // surfaces limpets owned by the viewer personally — clan-shared
    // tracking isn't in the schema yet).
    for (const t of msg.targets) {
        ctx.io.term.writeln(
            render(PANEL.limpetScanRow, {
                sector: String(t.sectorNumber).padStart(6),
                kind: 'Personal',
            }),
        );
    }
    ctx.io.term.writeln(
        render(PANEL.limpetScanTotalsRow, { qty: String(msg.targets.length).padStart(4) }),
    );
};

export const mineDisruptor: Handler<'mineDisruptorResult', MinesContext> = (ctx, msg) => {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(
        `Disruptor pulse to sector ${msg.targetSector}: ` +
            `removed ${msg.minesDisrupted} proximity mine(s) ` +
            `(${msg.proximityMinesRemaining} remaining).`,
    );
};

export const proximityMineHit: Handler<'proximityMineHit', MinesContext> = (ctx, msg) => {
    ctx.io.term.writeln('');
    if (msg.destroyed) {
        ctx.io.term.writeln(
            `*** ${msg.detonations} proximity mine(s) detonated for ${msg.damage} damage — ship destroyed! ***`,
        );
    } else {
        ctx.io.term.writeln(
            `${msg.detonations} proximity mine(s) detonated for ${msg.damage} damage ` +
                `(shields -${msg.shieldsLost}, drones -${msg.dronesLost}).`,
        );
    }
};

export const seekerMineAttached: Handler<'seekerMineAttached', MinesContext> = (ctx, msg) => {
    ctx.io.term.writeln('');
    if (msg.droppedPrevious) {
        ctx.io.term.writeln(`A limpet mine has attached to your ship — the previous one fell off.`);
    } else {
        ctx.io.term.writeln(`A limpet mine has attached to your ship in sector ${msg.sector}.`);
    }
};

export const seekerMinePickupAlert: Handler<'seekerMinePickupAlert', MinesContext> = (ctx, msg) => {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(
        `[ALERT] One of your limpet mines latched onto ${msg.targetOwnerName} in sector ${msg.sector}.`,
    );
};
