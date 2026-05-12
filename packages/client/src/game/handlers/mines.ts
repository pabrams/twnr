import type { GameContext } from '../types.js';
import type { Handler } from './index.js';
import { render } from '../renderer.js';
import { EVENT } from '../messages/index.js';

type MinesContext = Pick<GameContext, 'io' | 'world'>;

export const deployMine: Handler<'deployMineResult', MinesContext> = (ctx, msg) => {
    const label = msg.mineType === 'seeker' ? 'Seeker' : 'Proximity';
    ctx.io.term.writeln(
        render(EVENT.deployMineResult, {
            label,
            ship: msg.shipMines,
            sector: msg.sectorMines,
        }),
    );
};

export const listDeployedMines: Handler<'listDeployedMinesResult', MinesContext> = (ctx, msg) => {
    ctx.io.term.writeln('');
    if (msg.mines.length === 0) {
        ctx.io.term.writeln('No mines deployed.');
        return;
    }
    ctx.io.term.writeln('Your deployed mines:');
    for (const m of msg.mines) {
        const label = m.mineType === 'seeker' ? 'Seeker' : 'Proximity';
        ctx.io.term.writeln(`  Sector ${m.sectorNumber}: ${m.quantity} ${label} — ${m.ownerLabel}`);
    }
};

export const trackSeekerMines: Handler<'trackSeekerMinesResult', MinesContext> = (ctx, msg) => {
    ctx.io.term.writeln('');
    if (msg.targets.length === 0) {
        ctx.io.term.writeln('No seeker mines currently attached.');
        return;
    }
    ctx.io.term.writeln('Seeker mines tracking:');
    for (const t of msg.targets) {
        ctx.io.term.writeln(
            `  Sector ${t.sectorNumber}: ${t.targetOwnerName}'s ${t.targetShipName}`,
        );
    }
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
        ctx.io.term.writeln(`A seeker mine has attached to your ship — the previous one fell off.`);
    } else {
        ctx.io.term.writeln(`A seeker mine has attached to your ship in sector ${msg.sector}.`);
    }
};

export const seekerMinePickupAlert: Handler<'seekerMinePickupAlert', MinesContext> = (ctx, msg) => {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(
        `[ALERT] One of your seeker mines latched onto ${msg.targetOwnerName} in sector ${msg.sector}.`,
    );
};
