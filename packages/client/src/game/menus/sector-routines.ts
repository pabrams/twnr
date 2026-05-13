import { ClientTag, Menu, ServerTag } from '@twnr/shared';
import { render } from '../renderer.js';
import { COMPUTER, EVENT, NOTIFY, PLANET, SECTOR } from '../messages/index.js';
import {
    echoCommand,
    hideMoveMenuOverlay,
    showMoveMenu,
    showPortMenu,
    showPlayerInfo,
} from '../display.js';
import { showPlanetSelectMenu } from '../display-planet.js';
import {
    renderActiveShipScan,
    renderTransporterPrelude,
    renderTransporterOptions,
    renderShipDetail,
} from '../display-computer.js';
import { registerRoutine } from './types.js';
import {
    askChar,
    askConfirm,
    askDeployOwnership,
    askLineWithShortcuts,
    askNumber,
    awaitResponse,
} from './prompts.js';

registerRoutine('display_sector', (ctx) => {
    echoCommand(ctx, 'sectorDisplay');
    ctx.io.sendMsg({ type: ClientTag.SectorDisplay });
});

registerRoutine('move', (ctx, line) => {
    const sector = parseInt(line, 10);
    if (!Number.isFinite(sector)) return;
    echoCommand(ctx, 'move', { sector });
    ctx.io.sendMsg({ type: ClientTag.Move, sector });
});

registerRoutine('move_previous', (ctx) => {
    echoCommand(ctx, 'moveToPrevious');
    ctx.io.sendMsg({ type: ClientTag.MoveToPrevious });
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
    ctx.io.sendMsg({ type: ClientTag.Move, sector: target.sector });
});

registerRoutine('port_menu', async (ctx) => {
    showPortMenu(ctx);
    if (!ctx.world.currentPort) return;
    echoCommand(ctx, 'portInfo');
    const ch = await askChar(ctx, '', ['t', 's', 'q']);
    if (ch === null || ch === 'q') return;
    if (ch === 't') {
        if (ctx.world.currentPort.class === 9) return;
        ctx.io.sendMsg({ type: ClientTag.Dock });
        return;
    }
    if (ch === 's') {
        if (ctx.world.currentPort.class !== 9) return;
        ctx.io.sendMsg({ type: ClientTag.DockStarbase });
    }
});

registerRoutine('player_info', (ctx) => {
    echoCommand(ctx, 'shipInfo');
    showPlayerInfo(ctx);
});

registerRoutine('attack_menu', (ctx) => {
    echoCommand(ctx, 'attack');
    ctx.io.sendMsg({ type: ClientTag.GetAttackTargets });
});

registerRoutine('computer_menu', (ctx) => {
    echoCommand(ctx, 'computer');
    ctx.world.mode = Menu.Computer;
});

registerRoutine('deploy_drones_info', (ctx) => {
    echoCommand(ctx, 'deployDronesInfo');
    ctx.io.sendMsg({ type: ClientTag.DeployDronesInfo });
});

registerRoutine('jettison_menu', async (ctx) => {
    echoCommand(ctx, 'jettison');
    const ok = await askConfirm(ctx, render(SECTOR.jettisonConfirm), { defaultValue: false });
    if (ok) {
        ctx.io.sendMsg({ type: ClientTag.Jettison });
    }
});

registerRoutine('handle_mines_menu', async (ctx) => {
    const typeChar = await askChar(ctx, 'Handle (P)roximity or (L)impet mines? ', ['p', 'l']);
    if (typeChar === null) return;
    const mineType: 'proximity' | 'seeker' = typeChar === 'p' ? 'proximity' : 'seeker';

    ctx.io.sendMsg({ type: ClientTag.DeployMineInfo, mineType });
    const info = await awaitResponse(ctx, [ServerTag.DeployMineInfoResult, ServerTag.Error]);
    if (info === null) return;
    if (info.type !== ServerTag.DeployMineInfoResult) return;

    const label = mineType === 'seeker' ? 'Limpet' : 'Proximity';
    const total = info.shipMines + info.sectorMines;
    ctx.io.term.writeln('');
    ctx.io.term.writeln(
        render(EVENT.handleMinesInfo, {
            label,
            ship: info.shipMines,
            sector: info.sectorMines,
            max: info.shipMaxMines,
            total,
        }),
    );

    const qty = await askNumber(
        ctx,
        render(EVENT.handleMinesPrompt, { label }),
        { min: 0, defaultValue: -1 },
    );
    if (qty === null) return;
    const ownership = await askDeployOwnership(ctx, '\r\nOwnership (P)ersonal, (C)lan, (Q)? ');
    if (ownership === null) return;
    ctx.io.sendMsg({ type: ClientTag.DeployMine, mineType, quantity: qty, ownership });
});

registerRoutine('list_deployed_mines', (ctx) => {
    ctx.io.sendMsg({ type: ClientTag.ListDeployedMines });
});

registerRoutine('mine_disruptor_menu', async (ctx) => {
    const target = await askNumber(ctx, 'Mine disruptor — adjacent target sector? (Q to cancel) ', {
        min: 1,
    });
    if (target === null) return;
    ctx.io.sendMsg({ type: ClientTag.MineDisruptor, targetSector: target });
});

registerRoutine('land', async (ctx) => {
    echoCommand(ctx, 'land');
    ctx.io.sendMsg({ type: ClientTag.GetSectorPlanets });
    const response = await awaitResponse(ctx, [
        ServerTag.GetSectorPlanetsResult,
        ServerTag.LandOnPlanetResult,
        ServerTag.Error,
    ]);
    if (response === null) return;
    if (response.type !== ServerTag.GetSectorPlanetsResult) return;
    const planets = response.planets;
    if (planets.length === 0) {
        ctx.io.term.writeln(render(EVENT.noPlanetsToLand));
        return;
    }
    showPlanetSelectMenu(ctx, planets);
    const idx = await askNumber(ctx, render(PLANET.planetSelectPrompt), {
        min: 1,
        max: planets.length,
    });
    if (idx === null) return;
    echoCommand(ctx, 'landOnPlanet');
    ctx.io.sendMsg({ type: ClientTag.LandOnPlanet, planetId: planets[idx - 1].id });
});

registerRoutine('use_terraform_device', (ctx) => {
    echoCommand(ctx, 'terraformInfo');
    ctx.io.sendMsg({ type: ClientTag.TerraformInfo });
});

registerRoutine('starbase_info', (ctx) => {
    echoCommand(ctx, 'starbaseInfo');
    ctx.io.sendMsg({ type: ClientTag.StarbaseInfo });
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
    ctx.io.sendMsg({ type: ClientTag.PlayersOnline });
});

registerRoutine('clan_menu', (ctx) => {
    echoCommand(ctx, 'clanMenu');
    ctx.world.mode = Menu.Clan;
});

registerRoutine('transporter_pad', async (ctx) => {
    echoCommand(ctx, 'transporterPad');

    while (true) {
        ctx.io.sendMsg({ type: ClientTag.ListOwnedShips });
        const scan = await awaitResponse(ctx, [
            ServerTag.ListOwnedShipsResult,
            ServerTag.Error,
        ]);
        if (scan === null) return;
        if (scan.type !== ServerTag.ListOwnedShipsResult) return;

        renderTransporterPrelude(ctx, scan);
        renderActiveShipScan(ctx, scan, {
            sortByHops: true,
            rangeFromCurrentShip: scan.currentShipTransporterRange,
        });
        renderTransporterOptions(ctx);

        const choice = await askLineWithShortcuts(ctx, render(COMPUTER.transporterPrompt), [
            'i',
        ]);
        if (choice === null) return;

        if (choice.toLowerCase() === 'i') {
            const which = await askNumber(ctx, render(COMPUTER.transporterDetailsPrompt), {
                min: 1,
            });
            if (which === null) continue;
            const target = scan.ships.find((s) => s.shipNumber === which);
            if (!target) {
                ctx.io.term.writeln(render(COMPUTER.transporterUnknownShip));
                continue;
            }
            ctx.io.sendMsg({ type: ClientTag.GetShipDetail, shipId: target.id });
            const detail = await awaitResponse(ctx, [
                ServerTag.ShipDetailResult,
                ServerTag.Error,
            ]);
            if (detail === null) continue;
            if (detail.type !== ServerTag.ShipDetailResult) continue;
            renderShipDetail(ctx, detail);
            continue;
        }

        const shipNum = parseInt(choice, 10);
        if (!Number.isFinite(shipNum)) continue;

        const target = scan.ships.find((s) => s.shipNumber === shipNum);
        if (!target) {
            ctx.io.term.writeln(render(COMPUTER.transporterUnknownShip));
            continue;
        }
        if (target.id === scan.currentShipId) {
            ctx.io.term.writeln(render(COMPUTER.transporterCannotSelf));
            continue;
        }

        ctx.io.sendMsg({ type: ClientTag.TransportToShip, shipId: target.id });
        const result = await awaitResponse(ctx, [
            ServerTag.TransportToShipResult,
            ServerTag.Error,
        ]);
        if (result === null) return;
        if (result.type !== ServerTag.TransportToShipResult) continue;

        ctx.world.currentSector = result.targetSector;
        ctx.io.term.writeln('');
        ctx.io.term.writeln(render(COMPUTER.transporterSuccess));
        ctx.io.term.writeln('');
        ctx.io.term.writeln(
            render(COMPUTER.transporterTurnsLeft, { turns: result.turnsRemaining }),
        );
    }
});
