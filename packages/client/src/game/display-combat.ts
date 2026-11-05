import type { GameContext } from './types.js';
import { render } from './renderer.js';
import { COMBAT, COMMON } from './messages/index.js';
import { type DisplayCtx } from './display.js';

export type DisplayCombatCtx = Pick<GameContext, 'io' | 'world'> & DisplayCtx;

export function showDroneEncounter(
    ctx: DisplayCombatCtx,
    sectorDrones: number,
    ownerName: string,
    shipDrones: number,
) {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(COMBAT.droneEncounterHeader));
    ctx.io.term.writeln(render(COMBAT.droneSectorCount, { count: sectorDrones, owner: ownerName }));
    ctx.io.term.writeln(render(COMBAT.droneShipCount, { count: shipDrones }));
    if (shipDrones === 0) {
        ctx.io.term.writeln(render(COMBAT.droneNoDrones));
    }
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'A', text: 'Attack' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'R', text: 'Retreat' }));
}

export function showDroneEncounterPrompt(ctx: DisplayCombatCtx) {
    ctx.io.term.write(render(COMBAT.droneEncounterPrompt));
}
