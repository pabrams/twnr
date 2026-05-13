import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { PANEL } from '../messages/index.js';
import type { Handler } from './index.js';

type DronesCtx = Pick<GameContext, 'io'>;

export const listDeployedDrones: Handler<'listDeployedDronesResult', DronesCtx> = (ctx, msg) => {
    const { term } = ctx.io;
    term.writeln('');
    if (msg.drones.length === 0) {
        term.writeln(render(PANEL.deployedDronesEmpty));
        return;
    }
    term.writeln(render(PANEL.deployedDronesTitle));
    term.writeln('');
    term.writeln(render(PANEL.deployedDronesColumns));
    term.writeln(render(PANEL.deployedDronesRule));
    let totalDrones = 0;
    const totalTolls = 0;
    for (const d of msg.drones) {
        const kind =
            d.ownership.kind === 'player'
                ? 'Personal'
                : d.ownership.kind === 'clan'
                  ? 'Clan'
                  : 'Rogue';
        term.writeln(
            render(PANEL.deployedDronesRow, {
                sector: String(d.sectorId).padStart(6),
                qty: String(d.quantity).padStart(4),
                kind: kind.padEnd(8),
                mode: 'Defensive'.padEnd(11),
                tolls: 'N/A'.padStart(5),
            }),
        );
        totalDrones += d.quantity;
    }
    term.writeln(
        render(PANEL.deployedDronesTotalsRow, {
            qty: String(totalDrones).padStart(4),
            tolls: String(totalTolls).padStart(3),
        }),
    );
};
