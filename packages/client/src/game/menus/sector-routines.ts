import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { NOTIFY } from '../messages/index.js';
import { echoCommand, showPortMenu, showPlayerInfo, showPrompt } from '../display.js';
import { registerRoutine } from './types.js';
import { askConfirm } from './prompts.js';

/**
 * Sector menu routines. The sector menu file (`menus/sector.ts`) no longer
 * has an `input` switch — keystroke dispatch goes through input.ts's
 * `dispatchByRegistry`, which maps each keyPattern to its `command.name`
 * and invokes the routine registered here.
 *
 * `back` / `help_menu` / `list_deployed_drones` are registered in
 * `common-routines.ts` and serve sector too.
 */

// Empty Enter (re-display the sector). Backed by a `<enter>` key_pattern row
// in the menu_command table for sector.
registerRoutine('display_sector', (ctx) => {
    echoCommand(ctx, 'sectorDisplay');
    ctx.io.sendMsg({ type: ClientMsgType.SectorDisplay });
});

registerRoutine('move', (ctx, line) => {
    const sector = parseInt(line, 10);
    if (!Number.isFinite(sector)) return;
    echoCommand(ctx, 'move', { sector });
    ctx.io.sendMsg({ type: ClientMsgType.Move, sector });
});

registerRoutine('move_previous', (ctx) => {
    echoCommand(ctx, 'moveToPrevious');
    ctx.io.sendMsg({ type: ClientMsgType.MoveToPrevious });
});

registerRoutine('move_menu', (ctx) => {
    echoCommand(ctx, 'moveMenu');
    ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Move });
});

// 'P' from sector: enter port menu, but only if there's a port here. Otherwise
// render a local "no port" message and stay put. The guard reads
// ctx.world.currentPort which is updated on every sector display.
registerRoutine('port_menu', (ctx) => {
    if (!ctx.world.currentPort) {
        showPortMenu(ctx);
        return;
    }
    echoCommand(ctx, 'portInfo');
    ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Port });
});

registerRoutine('player_info', (ctx) => {
    echoCommand(ctx, 'shipInfo');
    showPlayerInfo(ctx);
});

registerRoutine('attack_menu', (ctx) => {
    echoCommand(ctx, 'attack');
    ctx.io.sendMsg({ type: ClientMsgType.Attack });
});

registerRoutine('computer_menu', (ctx) => {
    echoCommand(ctx, 'computer');
    ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Computer });
});

registerRoutine('deploy_drones_info', (ctx) => {
    echoCommand(ctx, 'deployDronesInfo');
    ctx.io.sendMsg({ type: ClientMsgType.DeployDronesInfo });
});

registerRoutine('jettison_menu', (ctx) => {
    echoCommand(ctx, 'jettison');
    ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.JettisonConfirm });
});

registerRoutine('deploy_mines_menu', (ctx) => {
    ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.DeployMines });
});

registerRoutine('list_deployed_mines', (ctx) => {
    ctx.io.sendMsg({ type: ClientMsgType.ListDeployedMines });
});

registerRoutine('mine_disruptor_menu', (ctx) => {
    ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.MineDisruptorTarget });
});

registerRoutine('land', (ctx) => {
    echoCommand(ctx, 'land');
    ctx.io.sendMsg({ type: ClientMsgType.Land });
});

registerRoutine('use_terraform_device', (ctx) => {
    echoCommand(ctx, 'terraformInfo');
    ctx.io.sendMsg({ type: ClientMsgType.TerraformInfo });
});

registerRoutine('starbase_info', (ctx) => {
    echoCommand(ctx, 'starbaseInfo');
    ctx.io.sendMsg({ type: ClientMsgType.StarbaseInfo });
});

// Quit: client-side confirm via askConfirm. No server roundtrip needed
// before close — quitConfirm menu is no longer involved. Plain Enter
// defaults to No (the prompt text already says "[N]").
registerRoutine('quit_game', async (ctx) => {
    echoCommand(ctx, 'quit');
    const ok = await askConfirm(ctx, render(NOTIFY.quitConfirm), { defaultValue: false });
    if (ok) {
        ctx.io.term.writeln(render(NOTIFY.goodbye));
        ctx.io.ws.close();
        return;
    }
    showPrompt(ctx);
});

registerRoutine('players_online', (ctx) => {
    echoCommand(ctx, 'playersOnline');
    ctx.io.sendMsg({ type: ClientMsgType.PlayersOnline });
});
