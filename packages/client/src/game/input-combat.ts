import { ClientMsgType } from '@twnr/shared';
import type { GameContext } from './types.js';
import { showPrompt } from './display.js';
import { showAttackFightersPrompt, showFighterAttackQtyPrompt } from './display-combat.js';
import { colors } from './constants.js';

export function handleAttackInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu('sector');
        showPrompt(ctx);
        return;
    }
    const idx = parseInt(line, 10) - 1;
    if (idx >= 0 && idx < ctx.sectorPlayers.length) {
        ctx.setAttackTarget(ctx.sectorPlayers[idx].id);
        showAttackFightersPrompt(ctx);
    } else {
        ctx.term.writeln(colors.boldRed('Invalid selection.'));
    }
}

export function handleAttackFightersInput(ctx: GameContext, line: string) {
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
        fighters: qty,
    });
}

export function handleDeployFightersQtyInput(ctx: GameContext, line: string) {
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
    ctx.sendMsg({ type: ClientMsgType.DeployFighters, quantity: qty });
}

export function handleFighterEncounterInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 'a':
            showFighterAttackQtyPrompt(ctx);
            break;
        case 'r':
            ctx.sendMsg({ type: ClientMsgType.RetreatFromFighters });
            break;
        default:
            ctx.term.writeln(`  ${colors.cyan('A')}  Attack`);
            ctx.term.writeln(`  ${colors.cyan('R')}  Retreat`);
    }
}

export function handleFighterAttackQtyInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu('fighterEncounter');
        return;
    }
    const qty = parseInt(line, 10);
    if (isNaN(qty) || qty <= 0) {
        ctx.term.writeln('Enter a positive number.');
        return;
    }
    ctx.sendMsg({ type: ClientMsgType.AttackSectorFighters, fighters: qty });
}
