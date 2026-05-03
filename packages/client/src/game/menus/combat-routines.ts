import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { NOTIFY } from '../messages/index.js';
import { registerRoutine, registerMenuRoutine } from './types.js';

/**
 * Attack-flow routines: pick a target from the sector's player list, then
 * choose a drone count. `back` is in common-routines.ts.
 */

registerRoutine('select_target', (ctx, line) => {
    const idx = parseInt(line, 10) - 1;
    if (idx < 0 || idx >= ctx.world.sectorPlayers.length) {
        ctx.io.term.writeln(render(NOTIFY.invalidSelection));
        return;
    }
    ctx.encounter.attackTarget = ctx.world.sectorPlayers[idx].id;
    ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.AttackDrones });
});

// Drones quantity for ship attack. The attackDrones menu's only purpose is
// to hold this numeric prompt; once `attack_menu` and the qty-prompt
// collapse pattern are aligned, this routine will move into the
// select_target flow via askNumber and the attackDrones menu can be
// deleted. For now, it stays as a menu so the existing flow keeps
// working — the routine is menu-scoped because `enter_quantity` is a
// shared command name across several single-prompt menus.
registerMenuRoutine(Menu.AttackDrones, 'enter_quantity', (ctx, line) => {
    const qty = parseInt(line, 10);
    if (isNaN(qty) || qty <= 0) {
        ctx.io.term.writeln('Enter a positive number.');
        return;
    }
    ctx.io.sendMsg({
        type: ClientMsgType.AttackShip,
        targetPlayerId: ctx.encounter.attackTarget!,
        drones: qty,
    });
});
