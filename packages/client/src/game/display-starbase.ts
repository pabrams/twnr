import type { GameContext } from './types.js';
import { colors } from './constants.js';

const mg = colors.magenta;

export function showStarbasePrompt(ctx: GameContext) {
    ctx.term.write(
        `\r\n${mg('<')}${colors.boldCyan('Starbase')}${mg('>')} ${mg('Where to?')} ${mg('(')}${colors.boldYellow('?')}=${colors.boldYellow('Help')}${mg(')')} `,
    );
}

export function showStarbaseMenu(ctx: GameContext) {
    ctx.setMode('starbase');
    showStarbasePrompt(ctx);
}

export function showStarbaseHelp(ctx: GameContext) {
    ctx.term.writeln('');
    ctx.term.writeln(`  ${colors.cyan('H')}  Hardware Store`);
    ctx.term.writeln(`  ${colors.cyan('Q')}  Leave Starbase`);
    showStarbasePrompt(ctx);
}

export function showHardwarePrompt(ctx: GameContext) {
    ctx.term.write(
        `\r\n${mg('<')}${colors.boldCyan('Starbase Hardware')}${mg('>')} ${mg('What do you need')} ${mg('(')}${colors.boldYellow('?')}${mg(')')}${mg('?')} `,
    );
}

function fmt(n: number): string {
    return n.toLocaleString();
}

export function showHardwareMenu(ctx: GameContext) {
    ctx.setMode('starbaseHardware');
    showHardwarePrompt(ctx);
}

export function showHardwareHelp(ctx: GameContext) {
    const p = ctx.hardwarePrices;
    ctx.term.writeln('');
    if (p) {
        ctx.term.writeln(`  ${colors.cyan('T')}  Terraform Device  ${colors.white(fmt(p.terraformDevice))}`);
        ctx.term.writeln(`  ${colors.cyan('B')}  Planet Buster      ${colors.white(fmt(p.planetBuster))}`);
        ctx.term.writeln(`  ${colors.cyan('U')}  Space Buoy         ${colors.white(fmt(p.spaceBuoy))}`);
        ctx.term.writeln(`  ${colors.cyan('P')}  Proximity Mine     ${colors.white(fmt(p.proximityMine))}`);
        ctx.term.writeln(`  ${colors.cyan('S')}  Seeker Mine        ${colors.white(fmt(p.seekerMine))}`);
        ctx.term.writeln(`  ${colors.cyan('O')}  Orbital Mine       ${colors.white(fmt(p.orbitalMine))}`);
        ctx.term.writeln(`  ${colors.cyan('D')}  Mine Disruptor     ${colors.white(fmt(p.mineDisruptor))}`);
        ctx.term.writeln(`  ${colors.cyan('1')}  Hyperspace Drive 1 ${colors.white(fmt(p.hyperspace1))}`);
        ctx.term.writeln(`  ${colors.cyan('2')}  Hyperspace Drive 2 ${colors.white(fmt(p.hyperspace2))}`);
        ctx.term.writeln(`  ${colors.cyan('V')}  Visual Scanner     ${colors.white(fmt(p.visualScanner))}`);
        ctx.term.writeln(`  ${colors.cyan('N')}  Planet Scanner     ${colors.white(fmt(p.planetScanner))}`);
        ctx.term.writeln(`  ${colors.cyan('K')}  Cloaking Device    ${colors.white(fmt(p.cloakingDevice))}`);
        ctx.term.writeln(`  ${colors.cyan('C')}  Corbomite          ${colors.white(fmt(p.corbomite))}`);
        ctx.term.writeln(`  ${colors.cyan('H')}  Photon Torpedo     ${colors.white(fmt(p.photonTorpedo))}`);
        ctx.term.writeln(`  ${colors.cyan('R')}  Recon Drone        ${colors.white(fmt(p.reconDrone))}`);
    }
    ctx.term.writeln(`  ${colors.cyan('Q')}  Back`);
    showHardwarePrompt(ctx);
}

export function showBuyQtyPrompt(ctx: GameContext, item: string) {
    ctx.setMode('starbaseBuyQty');
    ctx.term.write(`\r\n${colors.cyan(`How many ${item}?`)} `);
}

export function showPlanetSelectMenu(
    ctx: GameContext,
    planets: { id: number; name: string; type: string }[],
) {
    ctx.setMode('planetSelect');
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
    ctx.setMode('hyperspaceJumpTarget');
    ctx.term.write(`\r\n${colors.cyan('Target sector for hyperspace jump?')} `);
}
