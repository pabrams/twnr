import type { GameContext } from './types.js';
import { colors } from './constants.js';
import { showPrompt } from './display.js';

export function showPlanetMenu(ctx: GameContext, name: string, colonists: number) {
    ctx.setMode('planet');
    ctx.term.writeln('');
    ctx.term.writeln(
        `${colors.boldGreen('Landing on')} ${colors.boldCyan(name)}${colors.boldYellow('...')}`,
    );
    ctx.term.writeln(
        `  ${colors.boldYellow('Colonists')}: ${colors.white(colonists.toLocaleString())}`,
    );
    showPlanetPrompt(ctx);
}

export function showPlanetMenuOptions(ctx: GameContext) {
    showPlanetPrompt(ctx);
}

export function showPlanetHelp(ctx: GameContext) {
    ctx.term.writeln('');
    ctx.term.writeln(`  ${colors.cyan('T')}  Take colonists aboard`);
    ctx.term.writeln(`  ${colors.cyan('L')}  Leave colonists on planet`);
    ctx.term.writeln(`  ${colors.cyan('D')}  Planet Info`);
    ctx.term.writeln(`  ${colors.cyan('Z')}  Destroy Planet`);
    ctx.term.writeln(`  ${colors.cyan('Q')}  Leave Planet`);
    showPlanetPrompt(ctx);
}

function showPlanetPrompt(ctx: GameContext) {
    const mg = colors.magenta;
    ctx.term.write(
        `\r\n${mg('Planet command')} ${mg('(')}${colors.boldYellow('?')}=${colors.boldYellow('Help')}${mg(')')} ${colors.boldYellow('?')} `,
    );
}

export function showEarthMenu(ctx: GameContext, colonistsFuel: number) {
    ctx.term.writeln('');
    ctx.term.writeln(
        `${colors.boldGreen('Earth')} — ${colors.boldYellow('Colonists')}: ${colors.white(colonistsFuel.toLocaleString())}`,
    );
    ctx.term.writeln('');
    ctx.term.writeln(`  ${colors.cyan('T')}  Take colonists aboard`);
    ctx.term.writeln(`  ${colors.cyan('L')}  Leave colonists on planet`);
    ctx.term.writeln(`  ${colors.cyan('Q')}  Leave Earth`);
}

export function showPlanetTakePrompt(ctx: GameContext) {
    ctx.term.write(`\r\n${colors.cyan('How many colonists to take?')} `);
}

export function showPlanetLeavePrompt(ctx: GameContext) {
    ctx.term.write(`\r\n${colors.cyan('How many colonists to leave?')} `);
}

export function showPlanetTakeCommodityMenu(ctx: GameContext) {
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldCyan('Which colonists to take?'));
    ctx.term.writeln(`  ${colors.cyan('F')}  Fuel colonists`);
    ctx.term.writeln(`  ${colors.cyan('O')}  Organics colonists`);
    ctx.term.writeln(`  ${colors.cyan('E')}  Equipment colonists`);
    ctx.term.writeln(`  ${colors.cyan('Q')}  Back`);
}

export function showPlanetLeaveCommodityMenu(ctx: GameContext) {
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldCyan('Assign colonists to which commodity?'));
    ctx.term.writeln(`  ${colors.cyan('F')}  Fuel`);
    ctx.term.writeln(`  ${colors.cyan('O')}  Organics`);
    ctx.term.writeln(`  ${colors.cyan('E')}  Equipment`);
    ctx.term.writeln(`  ${colors.cyan('Q')}  Back`);
}

export function showNoPlanet(ctx: GameContext) {
    ctx.term.writeln('');
    ctx.term.writeln(
        colors.white(
            'There is no planet in this sector. You could create one with a Terraform Device.',
        ),
    );
    showPrompt(ctx);
}
