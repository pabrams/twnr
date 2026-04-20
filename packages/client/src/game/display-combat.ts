import type { GameContext } from './types.js';
import { render } from './renderer.js';
import { COMBAT, COMMON } from './messages/index.js';
import { showPrompt } from './display.js';

export function showAttackMenu(ctx: GameContext) {
    if (ctx.sectorPlayers.length === 0) {
        ctx.term.writeln(render(COMBAT.attackNoTargets));
        showPrompt(ctx);
        return;
    }
    ctx.term.writeln('');
    ctx.term.writeln(render(COMBAT.attackHeader));
    ctx.sectorPlayers.forEach((p, i) => {
        ctx.term.writeln(render(COMBAT.attackTarget, { n: i + 1, name: p.name }));
    });
    ctx.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Cancel' }));
}

export function showAttackDronesPrompt(ctx: GameContext) {
    ctx.term.write(render(COMBAT.attackQtyPrompt));
}

export function showDroneEncounter(
    ctx: GameContext,
    sectorDrones: number,
    ownerName: string,
    shipDrones: number,
) {
    ctx.term.writeln('');
    ctx.term.writeln(render(COMBAT.droneEncounterHeader));
    ctx.term.writeln(render(COMBAT.droneSectorCount, { count: sectorDrones, owner: ownerName }));
    ctx.term.writeln(render(COMBAT.droneShipCount, { count: shipDrones }));
    if (shipDrones === 0) {
        ctx.term.writeln(render(COMBAT.droneNoDrones));
    }
    ctx.term.writeln(render(COMMON.menuRow, { key: 'A', text: 'Attack' }));
    ctx.term.writeln(render(COMMON.menuRow, { key: 'R', text: 'Retreat' }));
}

export function showDroneAttackQtyPrompt(ctx: GameContext) {
    ctx.term.write(render(COMBAT.droneAttackQtyPrompt));
}
