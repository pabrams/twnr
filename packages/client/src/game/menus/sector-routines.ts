import { ClientMsgType, Menu, ServerMsgType } from '@twnr/shared';
import { render } from '../renderer.js';
import { EVENT, NOTIFY, SECTOR, STARBASE } from '../messages/index.js';
import {
    echoCommand,
    hideMoveMenuOverlay,
    showMoveMenu,
    showPortMenu,
    showPlayerInfo,
} from '../display.js';
import { showPlanetSelectMenu } from '../display-starbase.js';
import { registerRoutine } from './types.js';
import { askChar, askConfirm, askNumber, awaitResponse } from './prompts.js';

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

// 'M' from sector: pick an adjacent sector from the cached warp list
// (ctx.world.currentWarps). The minimap overlay shows the 1..N badges; the
// askChar sub-prompt waits for the keystroke and sends one Move with the
// chosen destination. The dedicated `move` server menu was retired — this
// is purely client-side until the destination is known.
registerRoutine('move_menu', async (ctx) => {
    const warps = ctx.world.currentWarps.slice(0, 6);
    if (warps.length === 0) return;
    echoCommand(ctx, 'moveMenu');
    showMoveMenu(ctx);
    const allowed = warps.map((_, i) => String(i + 1));
    const ch = await askChar(ctx, render(SECTOR.moveMenuPrompt, { max: warps.length }), allowed);
    hideMoveMenuOverlay(ctx);
    if (ch === null) return;
    const idx = parseInt(ch, 10) - 1;
    const target = warps[idx];
    if (!target) return;
    echoCommand(ctx, 'move', { sector: target.sector });
    ctx.io.sendMsg({ type: ClientMsgType.Move, sector: target.sector });
});

// 'P' from sector: dock-confirm UI inline. Renders the port info + T/S/Q
// options and awaits a single keystroke. T docks (class 1-8) or is silently
// dropped at starbase; S enters starbase or is silently dropped at trade
// ports; Q cancels. Pre-dock used to be a server-tracked `port` menu
// transition — collapsed into this routine. The `port` menu name now means
// only "actively trading at a class 1-8 port".
registerRoutine('port_menu', async (ctx) => {
    showPortMenu(ctx);
    if (!ctx.world.currentPort) return;
    echoCommand(ctx, 'portInfo');
    const ch = await askChar(ctx, '', ['t', 's', 'q']);
    if (ch === null || ch === 'q') return;
    if (ch === 't') {
        if (ctx.world.currentPort.class === 9) return;
        ctx.io.sendMsg({ type: ClientMsgType.Dock });
        return;
    }
    if (ch === 's') {
        if (ctx.world.currentPort.class !== 9) return;
        ctx.io.sendMsg({ type: ClientMsgType.DockStarbase });
    }
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

// Jettison: client-side confirm via askConfirm. The jettisonConfirm menu
// existed only to hold this Y/N — collapsed inline. Server's
// JettisonResult sets the menu back to sector, so no client transition.
registerRoutine('jettison_menu', async (ctx) => {
    echoCommand(ctx, 'jettison');
    const ok = await askConfirm(ctx, render(SECTOR.jettisonConfirm), { defaultValue: false });
    if (ok) {
        ctx.io.sendMsg({ type: ClientMsgType.Jettison });
    }
});

// Deploy mines: askChar (proximity / seeker) then askNumber (qty),
// then send DeployMine. The deployMines and deployMinesQty menus that
// used to hold these prompts are deleted.
registerRoutine('deploy_mines_menu', async (ctx) => {
    const typeChar = await askChar(ctx, 'Deploy (P)roximity or (S)eeker mines? ', ['p', 's']);
    if (typeChar === null) return;
    const mineType = typeChar === 'p' ? 'proximity' : 'seeker';
    const label = mineType === 'seeker' ? 'Seeker' : 'Proximity';
    const qty = await askNumber(ctx, `How many ${label} mines to deploy? (Q to cancel) `, {
        min: 1,
    });
    if (qty === null) return;
    ctx.io.sendMsg({ type: ClientMsgType.DeployMine, mineType, quantity: qty });
});

registerRoutine('list_deployed_mines', (ctx) => {
    ctx.io.sendMsg({ type: ClientMsgType.ListDeployedMines });
});

// Mine disruptor: askNumber for adjacent target sector inline. The
// mineDisruptorTarget menu was a single-prompt menu; collapsed.
registerRoutine('mine_disruptor_menu', async (ctx) => {
    const target = await askNumber(ctx, 'Mine disruptor — adjacent target sector? (Q to cancel) ', {
        min: 1,
    });
    if (target === null) return;
    ctx.io.sendMsg({ type: ClientMsgType.MineDisruptor, targetSector: target });
});

// Land: ask the server for the sector's planet list, then handle the
// selection inline. The server treats the player as still in 'sector' for
// the whole flow — there is no planetSelect menu. If the sector has exactly
// one planet (Earth in sector 1), the server skips LandResult and replies
// with LandOnPlanetResult directly; awaitResponse sees the menu change to
// planet/planetEarth and resolves null, letting the global handler render.
registerRoutine('land', async (ctx) => {
    echoCommand(ctx, 'land');
    ctx.io.sendMsg({ type: ClientMsgType.Land });
    const response = await awaitResponse(ctx, [
        ServerMsgType.LandResult,
        ServerMsgType.LandOnPlanetResult,
        ServerMsgType.Error,
    ]);
    if (response === null) return;
    if (response.type !== ServerMsgType.LandResult) return;
    const planets = response.planets;
    if (planets.length === 0) {
        ctx.io.term.writeln(render(EVENT.noPlanetsToLand));
        return;
    }
    showPlanetSelectMenu(ctx, planets);
    const idx = await askNumber(ctx, render(STARBASE.planetSelectPrompt), {
        min: 1,
        max: planets.length,
    });
    if (idx === null) return;
    echoCommand(ctx, 'landOnPlanet');
    ctx.io.sendMsg({ type: ClientMsgType.LandOnPlanet, planetId: planets[idx - 1].id });
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
    }
});

registerRoutine('players_online', (ctx) => {
    echoCommand(ctx, 'playersOnline');
    ctx.io.sendMsg({ type: ClientMsgType.PlayersOnline });
});
