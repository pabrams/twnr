import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { showStarbaseMenu } from '../display-starbase.js';
import { registerMenu, registerRoutine } from './types.js';

/**
 * Pilot menu for the routine-registry pattern. No `input` switch: keystroke
 * dispatch goes through input.ts's `dispatchByRegistry`, which looks up the
 * pressed key in the cached menu registry and runs the routine below whose
 * key matches the `command.name`.
 *
 * `back`, `help_menu`, and `list_deployed_drones` are registered in
 * menus/common-routines.ts since they are reused across menus.
 */
registerMenu(Menu.Starbase, {
    renderPrompt: showStarbaseMenu,
});

registerRoutine('shipyards_menu', (ctx) => {
    echoCommand(ctx, 'shipyards');
    ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Shipyards });
});

registerRoutine('hardware_store', (ctx) => {
    echoCommand(ctx, 'hardwareStoreInfo');
    ctx.io.sendMsg({ type: ClientMsgType.HardwareStoreInfo });
});
