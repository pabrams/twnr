import { ClientMsgType } from '@twnr/shared';
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

/**
 * Routines that are not specific to one menu. The `back`, `help_menu`, and
 * `list_deployed_drones` commands are reused across many menus, so their
 * routines live here rather than being duplicated per file.
 */

/** Generic Back: client just sends Back; server reads currentMenu, looks up
 * parent_menu_id, runs any per-menu cleanup hook, and replies with the
 * parent's envelope. The echo text is the menu_command row's label, so
 * each menu can show its own flavor ("Leave Starbase", "Liftoff", ...). */
registerRoutine('back', (ctx) => {
    const menu = ctx.catalogs.menus.get(ctx.world.mode);
    const backRow = menu?.commands.find((c) => c.command === 'back');
    ctx.io.term.writeln(render(backEcho(backRow?.label), {}));
    ctx.io.sendMsg({ type: ClientMsgType.Back });
});

/** Generic Help: render the cached menu's commands as a key-text list.
 * Replaces per-menu showXyzHelp functions and the hardcoded HELP_LINES.
 * Filters out '?' and '<...>' patterns from the listing — those aren't
 * directly addressable by the user as discrete keys to remember. */
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
    // Framework auto-renders the menu's prompt after this handler returns.
});

registerRoutine('list_deployed_drones', (ctx) => {
    echoCommand(ctx, 'listDeployedDrones');
    ctx.io.sendMsg({ type: ClientMsgType.ListDeployedDrones });
});
