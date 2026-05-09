import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { render } from '../renderer.js';
import { HELP } from '../messages/index.js';
import { registerRoutine } from './types.js';

/** Render the per-menu Back echo from the menu_command label, e.g. the
 * starbase row's "Leave Starbase" → "<Leave Starbase>". Falls back to
 * "<Back>" if the row has no label. */
function backEcho(label: string | undefined): string {
    return `[bg:b]<${label ?? 'Back'}>[/bg:b]`;
}


registerRoutine('back', (ctx) => {
    const menu = ctx.catalogs.menus.get(ctx.world.mode);
    const backRow = menu?.commands.find((c) => c.command === 'back');
    ctx.io.term.writeln(render(backEcho(backRow?.label), {}));
    if (ctx.world.mode === Menu.Starbase) {
        ctx.io.sendMsg({ type: ClientMsgType.LeaveStarbase });
    } else if (ctx.world.mode === Menu.Shipyards) {
        ctx.world.mode = Menu.Starbase;
    } else if (ctx.world.mode === Menu.ShipyardsClass0) {
        ctx.world.mode = Menu.Shipyards;
    }
});

registerRoutine('help_menu', (ctx) => {
    const menu = ctx.catalogs.menus.get(ctx.world.mode);
    if (!menu) return;
    const term = ctx.io.term;
    term.writeln('');
    term.writeln(render(HELP.header));
    for (const cmd of menu.commands) {
        const k = cmd.keyPattern;
        if (k === '?') continue;
        const display = k.startsWith('<') ? k : k.toUpperCase();
        term.writeln(render(HELP.lineKey, { key: display, text: cmd.label }));
    }
});

registerRoutine('list_deployed_drones', (ctx) => {
    echoCommand(ctx, 'listDeployedDrones');
    ctx.io.sendMsg({ type: ClientMsgType.ListDeployedDrones });
});
