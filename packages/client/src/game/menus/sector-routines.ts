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
    ctx.io.sendMsg({ type: ClientMsgType.GetAttackTargets });
});

registerRoutine('computer_menu', (ctx) => {
    echoCommand(ctx, 'computer');
    ctx.world.mode = Menu.Computer;
});

registerRoutine('deploy_drones_info', (ctx) => {
    echoCommand(ctx, 'deployDronesInfo');
    ctx.io.sendMsg({ type: ClientMsgType.DeployDronesInfo });
});

registerRoutine('jettison_menu', async (ctx) => {
    echoCommand(ctx, 'jettison');
    const ok = await askConfirm(ctx, render(SECTOR.jettisonConfirm), { defaultValue: false });
    if (ok) {
        ctx.io.sendMsg({ type: ClientMsgType.Jettison });
    }
});

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

registerRoutine('mine_disruptor_menu', async (ctx) => {
    const target = await askNumber(ctx, 'Mine disruptor — adjacent target sector? (Q to cancel) ', {
        min: 1,
    });
    if (target === null) return;
    ctx.io.sendMsg({ type: ClientMsgType.MineDisruptor, targetSector: target });
});

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
