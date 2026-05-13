import { ClientTag, ServerTag } from '@twnr/shared';
import { render } from '../renderer.js';
import { COMPUTER, NOTIFY } from '../messages/index.js';
import { echoCommand } from '../display.js';
import {
    showCurrentShipSpecs,
    showShipCatalog,
    showShipDetail,
    showPlanetSpecs,
    showPlanetDetail,
    showTraderList,
    renderVisitedSectorsResult,
    renderActiveShipScan,
} from '../display-computer.js';
import { indexToLetter, letterToIndex } from '../display-starbase.js';
import { registerRoutine } from './types.js';
import { askChar, askNumber, awaitResponse } from './prompts.js';

registerRoutine('known_universe', async (ctx) => {
    while (true) {
        const ch = await askChar(ctx, render(COMPUTER.knownUniversePrompt), ['e', 'u']);
        if (ch === null) return;
        const mode = ch === 'e' ? 'explored' : 'unexplored';
        ctx.io.sendMsg({ type: ClientTag.VisitedSectors });
        const response = await awaitResponse(ctx, [
            ServerTag.VisitedSectorsResult,
            ServerTag.Error,
        ]);
        if (response === null) return;
        if (response.type !== ServerTag.VisitedSectorsResult) return;
        renderVisitedSectorsResult(ctx, response, mode);
    }
});

registerRoutine('trader_list', async (ctx) => {
    await showTraderList(ctx);
});

registerRoutine('ship_catalog', async (ctx) => {
    await showShipCatalog(ctx);
    const ships = ctx.catalogs.ships;
    if (!ships || ships.length === 0) return;
    const letters = ships.map((_, i) => indexToLetter(i).toLowerCase());
    const allowed = [...letters, '?'];
    while (true) {
        const ch = await askChar(ctx, render(COMPUTER.shipInterestPrompt), allowed);
        if (ch === null) return;
        if (ch === '?') {
            await showShipCatalog(ctx);
            continue;
        }
        const idx = letterToIndex(ch);
        if (idx >= 0 && idx < ships.length) {
            showShipDetail(ctx, ships[idx]);
        } else {
            ctx.io.term.writeln(render(NOTIFY.invalidSelection));
        }
    }
});

registerRoutine('planet_specs', async (ctx) => {
    await showPlanetSpecs(ctx);
    const planets = ctx.catalogs.planets;
    if (!planets || planets.length === 0) return;
    const letters = planets.map((_, i) => indexToLetter(i).toLowerCase());
    const allowed = [...letters, '?'];
    while (true) {
        const ch = await askChar(ctx, render(COMPUTER.planetSpecsPrompt), allowed);
        if (ch === null) return;
        if (ch === '?') {
            await showPlanetSpecs(ctx);
            continue;
        }
        const idx = letterToIndex(ch);
        if (idx >= 0 && idx < planets.length) {
            showPlanetDetail(ctx, planets[idx]);
        } else {
            ctx.io.term.writeln(render(NOTIFY.invalidSelection));
        }
    }
});

registerRoutine('current_ship_specs', async (ctx) => {
    await showCurrentShipSpecs(ctx);
});

registerRoutine('hyperspace_jump', async (ctx) => {
    const sector = await askNumber(ctx, 'Hyperspace jump target sector? (Q to cancel) ', {
        min: 1,
    });
    if (sector === null) return;
    echoCommand(ctx, 'hyperspaceJump');
    ctx.io.sendMsg({ type: ClientTag.HyperspaceJump, targetSector: sector });
});

registerRoutine('list_planets', (ctx) => {
    echoCommand(ctx, 'listPlanets');
    ctx.io.sendMsg({ type: ClientTag.ListPlanets });
});

registerRoutine('track_seeker_mines', (ctx) => {
    ctx.io.sendMsg({ type: ClientTag.TrackSeekerMines });
});

registerRoutine('list_deployed_mines', async (ctx) => {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(COMPUTER.mineScanBanner));
    ctx.io.term.writeln('');
    const ch = await askChar(ctx, render(COMPUTER.mineScanPrompt), ['p', 'l']);
    if (ch === null) {
        ctx.world.mineScanFilter = null;
        return;
    }
    ctx.world.mineScanFilter = ch === 'p' ? 'proximity' : 'seeker';
    ctx.io.sendMsg({ type: ClientTag.ListDeployedMines });
});

registerRoutine('active_ship_scan', async (ctx) => {
    echoCommand(ctx, 'activeShipScan');
    ctx.io.sendMsg({ type: ClientTag.ListOwnedShips });
    const response = await awaitResponse(ctx, [
        ServerTag.ListOwnedShipsResult,
        ServerTag.Error,
    ]);
    if (response === null) return;
    if (response.type !== ServerTag.ListOwnedShipsResult) return;
    renderActiveShipScan(ctx, response);
});

registerRoutine('change_ship_ownership', async (ctx) => {
    echoCommand(ctx, 'changeShipOwnership');
    const ch = await askChar(ctx, render(COMPUTER.ownershipPrompt), ['p', 'c']);
    if (ch === null) return;
    const ownership = ch === 'p' ? 'personal' : 'clan';
    ctx.io.sendMsg({ type: ClientTag.ChangeShipOwnership, ownership });
    const result = await awaitResponse(ctx, [
        ServerTag.ChangeShipOwnershipResult,
        ServerTag.Error,
    ]);
    if (result === null) return;
    if (result.type !== ServerTag.ChangeShipOwnershipResult) return;
    ctx.io.term.writeln(
        render(
            result.ownership === 'clan'
                ? COMPUTER.ownershipResultClan
                : COMPUTER.ownershipResultPersonal,
        ),
    );
});
