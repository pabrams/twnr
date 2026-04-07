import type { GameContext } from './types.js';
import { colors } from './constants.js';

export function showStarbaseMenu(ctx: GameContext) {
    ctx.changeMenu('starbase');
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldCyan('=== Starbase ==='));
    ctx.term.writeln(`  ${colors.cyan('S')}  Ship Exchange`);
    ctx.term.writeln(`  ${colors.cyan('H')}  Hardware Store`);
    ctx.term.writeln(`  ${colors.cyan('D')}  Deployed Drones`);
    ctx.term.writeln(`  ${colors.cyan('Q')}  Leave Starbase`);
}

export function showHardwareMenu(ctx: GameContext) {
    ctx.changeMenu('starbaseHardware');
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldCyan('=== Hardware Store ==='));
    ctx.term.writeln(`  ${colors.cyan('B')}  Buy Planet Busters (20,000 credits)`);
    ctx.term.writeln(`  ${colors.cyan('T')}  Buy Terraform Devices (5,000 credits)`);
    ctx.term.writeln(`  ${colors.cyan('W')}  Buy Hyperwarp Drive (50,000 credits)`);
    ctx.term.writeln(`  ${colors.cyan('Q')}  Back`);
}

export function showBuyQtyPrompt(ctx: GameContext, item: string) {
    ctx.changeMenu('starbaseBuyQty');
    ctx.term.write(`\r\n${colors.cyan(`How many ${item}?`)} `);
}

export function showPlanetSelectMenu(
    ctx: GameContext,
    planets: { id: number; name: string; type: string }[],
) {
    ctx.changeMenu('planetSelect');
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldCyan('=== Select a Planet ==='));
    planets.forEach((p, i) => {
        ctx.term.writeln(
            `  ${colors.boldYellow(String(i + 1))}  ${colors.white(p.name)} (${p.type})`,
        );
    });
    ctx.term.writeln(`  ${colors.cyan('Q')}  Back`);
}

export function showHyperspaceJumpPrompt(ctx: GameContext) {
    ctx.changeMenu('hyperspaceJumpTarget');
    ctx.term.write(`\r\n${colors.cyan('Target sector for hyperspace jump?')} `);
}
