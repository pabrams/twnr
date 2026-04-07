import type { GameContext } from './types.js';
import { colors } from './constants.js';
import { showPrompt } from './display.js';

export function showPlanetMenu(ctx: GameContext, name: string, colonists: number) {
    ctx.changeMenu('planet');
    ctx.term.writeln('');
    ctx.term.writeln(
        `${colors.boldGreen('Landing on')} ${colors.boldCyan(name)}${colors.boldYellow('...')}`,
    );
    ctx.term.writeln(
        `  ${colors.boldYellow('Colonists')}: ${colors.white(colonists.toLocaleString())}`,
    );
    ctx.term.writeln('');
    ctx.term.writeln(`  ${colors.cyan('T')}  Take colonists aboard`);
    ctx.term.writeln(`  ${colors.cyan('L')}  Leave colonists on planet`);
    ctx.term.writeln(`  ${colors.cyan('Q')}  Return to ship`);
}

export function showPlanetTakePrompt(ctx: GameContext) {
    ctx.changeMenu('planetTakeQty');
    ctx.term.write(`\r\n${colors.cyan('How many colonists to take?')} `);
}

export function showPlanetLeavePrompt(ctx: GameContext) {
    ctx.changeMenu('planetLeaveQty');
    ctx.term.write(`\r\n${colors.cyan('How many colonists to leave?')} `);
}

export function showNoPlanet(ctx: GameContext) {
    ctx.term.writeln('');
    ctx.term.writeln(
        colors.white(
            'There is no planet in this sector. You could create one with a Genesis Torpedo.',
        ),
    );
    showPrompt(ctx);
}
