import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { registerRoutine, setMenuArgs } from './types.js';

/**
 * Planet menu routines. The same `take_colonists` and `leave_colonists`
 * commands appear on both the regular planet menu and the Earth menu;
 * the routine reads `ctx.world.mode` to decide whether to ask for the
 * commodity (regular planets) or default to fuel (Earth-only). When the
 * commodity-pick + qty-prompt collapse lands, both branches will use
 * askChar/askNumber inside this routine and the four planetTakeQty,
 * planetLeaveQty, planetTakeCommodity, planetLeaveCommodity menus can be
 * deleted. back and help_menu come from common-routines.ts.
 */

registerRoutine('take_colonists', (ctx) => {
    echoCommand(ctx, 'takeColonists');
    if (ctx.world.mode === Menu.PlanetEarth) {
        setMenuArgs(ctx, { menu: Menu.PlanetTakeQty, commodity: 'fuel' });
        ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetTakeQty });
    } else {
        ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetTakeCommodity });
    }
});

registerRoutine('leave_colonists', (ctx) => {
    echoCommand(ctx, 'leaveColonists');
    if (ctx.world.mode === Menu.PlanetEarth) {
        setMenuArgs(ctx, { menu: Menu.PlanetLeaveQty, commodity: 'fuel' });
        ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetLeaveQty });
    } else {
        ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetLeaveCommodity });
    }
});

registerRoutine('planet_display', (ctx) => {
    echoCommand(ctx, 'planetDisplay');
    ctx.io.sendMsg({ type: ClientMsgType.PlanetDisplay });
});

registerRoutine('destroy_planet', (ctx) => {
    echoCommand(ctx, 'destroyPlanet');
    ctx.io.sendMsg({ type: ClientMsgType.DestroyPlanet });
});

registerRoutine('leave_planet', (ctx) => {
    echoCommand(ctx, 'leavePlanet');
    ctx.io.sendMsg({ type: ClientMsgType.LeavePlanet });
});
