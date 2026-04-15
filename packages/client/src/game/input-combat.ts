import { ClientMsgType } from '@twnr/shared';
import type { GameContext } from './types.js';
import { showPrompt } from './display.js';
import { showAttackDronesPrompt, showDroneAttackQtyPrompt } from './display-combat.js';
import { colors } from './constants.js';

export function handleAttackInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu('sector');
        showPrompt(ctx);
        return;
    }
    const idx = parseInt(line, 10) - 1;
    if (idx >= 0 && idx < ctx.sectorPlayers.length) {
        ctx.attackTarget = ctx.sectorPlayers[idx].id;
        ctx.changeMenu('attackDrones');
        showAttackDronesPrompt(ctx);
    } else {
        ctx.term.writeln(colors.boldRed('Invalid selection.'));
    }
}

export function handleAttackDronesInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu('sector');
        showPrompt(ctx);
        return;
    }
    const qty = parseInt(line, 10);
    if (isNaN(qty) || qty <= 0) {
        ctx.term.writeln('Enter a positive number.');
        return;
    }
    ctx.sendMsg({
        type: ClientMsgType.AttackShip,
        targetPlayerId: ctx.attackTarget!,
        drones: qty,
    });
}

export function handleDeployDronesQtyInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu('sector');
        showPrompt(ctx);
        return;
    }
    const qty = parseInt(line, 10);
    if (isNaN(qty) || qty < 0) {
        ctx.term.writeln('Enter a non-negative number (0 to retrieve all).');
        return;
    }
    ctx.sendMsg({ type: ClientMsgType.DeployDrones, quantity: qty });
}

export function handleDroneEncounterInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 'a':
            ctx.changeMenu('droneAttackQty');
            showDroneAttackQtyPrompt(ctx);
            break;
        case 'r':
            ctx.sendMsg({ type: ClientMsgType.RetreatFromDrones });
            break;
        default:
            ctx.term.writeln(`  ${colors.cyan('A')}  Attack`);
            ctx.term.writeln(`  ${colors.cyan('R')}  Retreat`);
    }
}

export function handleDroneAttackQtyInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu('droneEncounter');
        return;
    }
    const qty = parseInt(line, 10);
    if (isNaN(qty) || qty <= 0) {
        ctx.term.writeln('Enter a positive number.');
        return;
    }
    ctx.sendMsg({ type: ClientMsgType.AttackSectorDrones, drones: qty });
}
