import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import {
    showCurrentShipSpecs,
    showTraderList,
    showExploredSectors,
    showUnexploredSectors,
} from '../display-computer.js';
import { registerRoutine } from './types.js';
import { askNumber } from './prompts.js';

/**
 * Routines for the computer menu and its known-universe submenu. Most
 * commands are pure transitions or fire-and-forget messages; a couple
 * are local renderers (trader list, current-ship specs, explored /
 * unexplored sector listings) that run entirely client-side from
 * cached state. `back` and `help_menu` come from common-routines.ts.
 */

registerRoutine('known_universe', (ctx) => {
    ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.KnownUniverse });
});

registerRoutine('trader_list', (ctx) => {
    showTraderList(ctx);
});

registerRoutine('ship_catalog', (ctx) => {
    ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipCatalog });
});

registerRoutine('planet_specs', (ctx) => {
    ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.PlanetSpecs });
});

registerRoutine('current_ship_specs', (ctx) => {
    showCurrentShipSpecs(ctx);
});

// Hyperspace jump: askNumber for target sector inline. The
// hyperspaceJumpTarget single-prompt menu was collapsed.
registerRoutine('hyperspace_jump', async (ctx) => {
    const sector = await askNumber(ctx, 'Hyperspace jump target sector? (Q to cancel) ', {
        min: 1,
    });
    if (sector === null) return;
    echoCommand(ctx, 'hyperspaceJump');
    ctx.io.sendMsg({ type: ClientMsgType.HyperspaceJump, targetSector: sector });
});

registerRoutine('list_planets', (ctx) => {
    echoCommand(ctx, 'listPlanets');
    ctx.io.sendMsg({ type: ClientMsgType.ListPlanets });
});

registerRoutine('track_seeker_mines', (ctx) => {
    ctx.io.sendMsg({ type: ClientMsgType.TrackSeekerMines });
});

registerRoutine('explored_sectors', (ctx) => {
    showExploredSectors(ctx);
});

registerRoutine('unexplored_sectors', (ctx) => {
    showUnexploredSectors(ctx);
});
