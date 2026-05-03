import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { class0QtyPreamble } from '../display-port.js';
import { registerRoutine } from './types.js';
import { askNumber } from './prompts.js';

/**
 * Routines for the shipyards menu and its class-0 buy submenu (which is
 * also reused as the in-port class-0 trade menu). Pure router behavior:
 * each key transitions to a child menu or sends a parameterless message.
 * `back` and `help_menu` come from common-routines.ts.
 *
 * The class0/shipyardsClass0 a/b/c routines stash a `kind` arg so the
 * downstream qty menu knows which commodity the user is buying. When the
 * qty-prompt collapse lands, those will move into a single askNumber
 * call inside this routine.
 */

registerRoutine('buy_ship', (ctx) => {
    echoCommand(ctx, 'shipyardsBuy');
    ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipyardsBuy });
});

registerRoutine('examine_ships', (ctx) => {
    echoCommand(ctx, 'shipyardsExamine');
    ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipyardsExamine });
});

registerRoutine('shipyards_equipment', (ctx) => {
    echoCommand(ctx, 'shipyardsEquipment');
    ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipyardsClass0 });
});

// Shared by both the shipyards class-0 (build new ship) menu and the
// in-port class-0 trade menu. Inline preamble + askNumber → Buy* — no
// downstream qty menu (class0Qty / shipyardsClass0Qty are gone).
async function chooseClass0(
    ctx: import('../types.js').GameContext,
    kind: 'drones' | 'shields' | 'holds',
    echoKey: 'buyDrones' | 'buyShields' | 'buyHolds',
): Promise<void> {
    echoCommand(ctx, echoKey);
    const { promptText, max } = class0QtyPreamble(ctx, kind);
    if (max <= 0) return;
    // Empty Enter accepts max; cap upper bound so server doesn't bounce
    // an over-buy. min: 1 → 0 returns null (cancel).
    const qty = await askNumber(ctx, promptText, { defaultValue: max, min: 1, max });
    if (qty === null) return;
    if (kind === 'drones') ctx.io.sendMsg({ type: ClientMsgType.BuyDrones, quantity: qty });
    else if (kind === 'shields') ctx.io.sendMsg({ type: ClientMsgType.BuyShields, quantity: qty });
    else ctx.io.sendMsg({ type: ClientMsgType.BuyHolds, quantity: qty });
}

registerRoutine('choose_holds', (ctx) => chooseClass0(ctx, 'holds', 'buyHolds'));
registerRoutine('choose_drones', (ctx) => chooseClass0(ctx, 'drones', 'buyDrones'));
registerRoutine('choose_shields', (ctx) => chooseClass0(ctx, 'shields', 'buyShields'));

// Port class-0 menu's Q sends Undock (different from the generic back).
registerRoutine('leave_port', (ctx) => {
    echoCommand(ctx, 'undock');
    ctx.io.sendMsg({ type: ClientMsgType.Undock });
});
