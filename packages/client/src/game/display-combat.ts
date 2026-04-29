import type { GameContext } from './types.js';
import { render } from './renderer.js';
import { COMBAT, COMMON } from './messages/index.js';
import { showPrompt } from './display.js';

export function showAttackMenu(ctx: GameContext) {
    if (ctx.world.sectorPlayers.length === 0) {
        ctx.io.term.writeln(render(COMBAT.attackNoTargets));
        showPrompt(ctx);
        return;
    }
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(COMBAT.attackHeader));
    ctx.world.sectorPlayers.forEach((p, i) => {
        ctx.io.term.writeln(render(COMBAT.attackTarget, { n: i + 1, name: p.name }));
    });
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Cancel' }));
}

export function showAttackDronesPrompt(ctx: GameContext) {
    ctx.io.term.write(render(COMBAT.attackQtyPrompt));
}

export function showDroneEncounter(
    ctx: GameContext,
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

export function showDroneAttackQtyPrompt(ctx: GameContext) {
    ctx.io.term.write(render(COMBAT.droneAttackQtyPrompt));
}
