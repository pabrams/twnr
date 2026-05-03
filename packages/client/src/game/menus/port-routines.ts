import { ClientMsgType } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { registerRoutine } from './types.js';

/**
 * Port menu routines. Trade-port classes (1–8) use T to dock for trading;
 * class 9 (starbase) uses S to enter the starbase. The off-class key is
 * silently ignored so the wrong action can't be triggered by a typo.
 *
 * `back` is in common-routines.ts.
 */

registerRoutine('trade_at_port', (ctx) => {
    if (ctx.world.currentPort?.class === 9) return;
    echoCommand(ctx, 'dock');
    ctx.io.sendMsg({ type: ClientMsgType.Dock });
});

registerRoutine('dock_starbase', (ctx) => {
    if (ctx.world.currentPort?.class !== 9) return;
    echoCommand(ctx, 'dockStarbase');
    ctx.io.sendMsg({ type: ClientMsgType.DockStarbase });
});
