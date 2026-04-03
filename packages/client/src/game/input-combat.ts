import { ClientMsgType } from '@twnr/shared';
import type { GameContext } from './types.js';
import { showPrompt } from './display.js';
import { showAttackFightersPrompt } from './display-combat.js';
import { colors } from './constants.js';

export function handleAttackInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.setMode('sector');
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
        ctx.setMode('sector');
        showPrompt(ctx);
        return;
    }
    const qty = parseInt(line, 10);
    if (isNaN(qty) || qty <= 0) {
        ctx.term.writeln('Enter a positive number.');
        return;
    }
    ctx.sendMsg({ type: ClientMsgType.Attack, targetPlayerId: ctx.attackTarget!, fighters: qty });
}
