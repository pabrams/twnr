import type { GameContext } from './types.js';
import { colors } from './constants.js';
import { showPrompt } from './display.js';

export function showAttackMenu(ctx: GameContext) {
    if (ctx.sectorPlayers.length === 0) {
        ctx.term.writeln(`\r\n${colors.boldRed('No other players in this sector.')}`);
        showPrompt(ctx);
        return;
    }
    ctx.changeMenu('attack');
    ctx.term.writeln('');
    ctx.term.writeln(colors.cyan('Attack — Select target:'));
    ctx.sectorPlayers.forEach((p, i) => {
        ctx.term.writeln(`  ${colors.boldYellow(String(i + 1))}  ${colors.white(p.name)}`);
    });
    ctx.term.writeln(`  ${colors.cyan('Q')}  Cancel`);
}

export function showAttackFightersPrompt(ctx: GameContext) {
    ctx.changeMenu('attackFighters');
    ctx.term.write(`\r\n${colors.cyan('How many fighters to attack with?')} `);
}

export function showFighterEncounter(
    ctx: GameContext,
    sectorFighters: number,
    ownerName: string,
    shipFighters: number,
) {
    ctx.changeMenu('fighterEncounter');
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldRed('=== HOSTILE FIGHTERS DETECTED ==='));
    ctx.term.writeln(
        `  ${colors.boldYellow('Sector fighters')}: ${colors.boldRed(String(sectorFighters))} (owned by ${colors.boldYellow(ownerName)})`,
    );
    ctx.term.writeln(
        `  ${colors.boldYellow('Your ship fighters')}: ${colors.white(String(shipFighters))}`,
    );
    if (shipFighters === 0) {
        ctx.term.writeln(colors.boldRed('You have no fighters! You must retreat.'));
    }
    ctx.term.writeln(`  ${colors.cyan('A')}  Attack`);
    ctx.term.writeln(`  ${colors.cyan('R')}  Retreat`);
}

export function showFighterAttackQtyPrompt(ctx: GameContext) {
    ctx.changeMenu('fighterAttackQty');
    ctx.term.write(`\r\n${colors.cyan('How many fighters to send?')} `);
}
