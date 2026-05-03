import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand, hideMoveMenuOverlay } from '../display.js';
import { registerRoutine, registerMenuRoutine } from './types.js';

/**
 * Move menu: keys 1-6 select one of the current sector's outgoing warps.
 * Each select_warp_N command maps to the same routine; the last char of
 * the command name is the warp index. `back` lives in common-routines.ts.
 */

function selectWarp(ctx: import('../types.js').GameContext, n: number) {
    const warps = ctx.world.currentWarps.slice(0, 6);
    const target = warps[n - 1];
    if (!target) return;
    hideMoveMenuOverlay(ctx);
    echoCommand(ctx, 'move', { sector: target.sector });
    ctx.io.sendMsg({ type: ClientMsgType.Move, sector: target.sector });
}

registerRoutine('select_warp_1', (ctx) => selectWarp(ctx, 1));
registerRoutine('select_warp_2', (ctx) => selectWarp(ctx, 2));
registerRoutine('select_warp_3', (ctx) => selectWarp(ctx, 3));
registerRoutine('select_warp_4', (ctx) => selectWarp(ctx, 4));
registerRoutine('select_warp_5', (ctx) => selectWarp(ctx, 5));
registerRoutine('select_warp_6', (ctx) => selectWarp(ctx, 6));

// Override the generic `back` for the move menu: hide the overlay first,
// then dispatch the standard Back. The common-routines.ts `back` doesn't
// know about the overlay, so the move menu owns its own back routine.
registerMenuRoutine(Menu.Move, 'back', (ctx) => {
    hideMoveMenuOverlay(ctx);
    echoCommand(ctx, 'moveMenuBack');
    ctx.io.sendMsg({ type: ClientMsgType.Back });
});
