import type { GameContext } from './types.js';
import { colors } from './constants.js';
import { showPrompt } from './display.js';

export function showAttackMenu(ctx: GameContext) {
    if (ctx.sectorPlayers.length === 0) {
        ctx.term.writeln(`\r\n${colors.boldRed('No other players in this sector.')}`);
        showPrompt(ctx);
        return;
    }
    ctx.setMode('attack');
    ctx.term.writeln('');
    ctx.term.writeln(colors.cyan('Attack — Select target:'));
    ctx.sectorPlayers.forEach((p, i) => {
        ctx.term.writeln(`  ${colors.boldYellow(String(i + 1))}  ${colors.white(p.name)}`);
    });
    ctx.term.writeln(`  ${colors.cyan('Q')}  Cancel`);
}

export function showAttackFightersPrompt(ctx: GameContext) {
    ctx.setMode('attackFighters');
    ctx.term.write(`\r\n${colors.cyan('How many fighters to attack with?')} `);
}
