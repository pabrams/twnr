import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { registerRoutine, setMenuArgs } from './types.js';

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
// in-port class-0 trade menu. The downstream qty menu disambiguates via
// the menu it's presented in.
function chooseClass0(
    ctx: import('../types.js').GameContext,
    kind: 'drones' | 'shields' | 'holds',
    echoKey: 'buyDrones' | 'buyShields' | 'buyHolds',
) {
    echoCommand(ctx, echoKey);
    const target =
        ctx.world.mode === Menu.ShipyardsClass0 ? Menu.ShipyardsClass0Qty : Menu.Class0Qty;
    setMenuArgs(ctx, { menu: target, kind });
    ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: target });
}

registerRoutine('choose_holds', (ctx) => chooseClass0(ctx, 'holds', 'buyHolds'));
registerRoutine('choose_drones', (ctx) => chooseClass0(ctx, 'drones', 'buyDrones'));
registerRoutine('choose_shields', (ctx) => chooseClass0(ctx, 'shields', 'buyShields'));

// Port class-0 menu's Q sends Undock (different from the generic back).
registerRoutine('leave_port', (ctx) => {
    echoCommand(ctx, 'undock');
    ctx.io.sendMsg({ type: ClientMsgType.Undock });
});
