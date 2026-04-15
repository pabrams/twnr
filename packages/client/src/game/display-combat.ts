import { Menu } from '@twnr/shared';
import type { GameContext } from './types.js';
import { colors } from './constants.js';
import { showPrompt } from './display.js';

export function showAttackMenu(ctx: GameContext) {
    if (ctx.sectorPlayers.length === 0) {
        ctx.term.writeln(`\r\n${colors.boldRed('No other players in this sector.')}`);
        showPrompt(ctx);
        return;
    }
    ctx.mode = Menu.Attack;
    ctx.term.writeln('');
    ctx.term.writeln(colors.cyan('Attack — Select target:'));
    ctx.sectorPlayers.forEach((p, i) => {
        ctx.term.writeln(`  ${colors.boldYellow(String(i + 1))}  ${colors.white(p.name)}`);
    });
    ctx.term.writeln(`  ${colors.cyan('Q')}  Cancel`);
}

export function showAttackDronesPrompt(ctx: GameContext) {
    ctx.mode = Menu.AttackDrones;
    ctx.term.write(`\r\n${colors.cyan('How many drones to attack with?')} `);
}

export function showDroneEncounter(
    ctx: GameContext,
    sectorDrones: number,
    ownerName: string,
    shipDrones: number,
) {
    ctx.mode = Menu.DroneEncounter;
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldRed('=== HOSTILE DRONES DETECTED ==='));
    ctx.term.writeln(
        `  ${colors.boldYellow('Sector drones')}: ${colors.boldRed(String(sectorDrones))} (owned by ${colors.boldYellow(ownerName)})`,
    );
    ctx.term.writeln(
        `  ${colors.boldYellow('Your ship drones')}: ${colors.white(String(shipDrones))}`,
    );
    if (shipDrones === 0) {
        ctx.term.writeln(colors.boldRed('You have no drones! You must retreat.'));
    }
    ctx.term.writeln(`  ${colors.cyan('A')}  Attack`);
    ctx.term.writeln(`  ${colors.cyan('R')}  Retreat`);
}

export function showDroneAttackQtyPrompt(ctx: GameContext) {
    ctx.mode = Menu.DroneAttackQty;
    ctx.term.write(`\r\n${colors.cyan('How many drones to send?')} `);
}
