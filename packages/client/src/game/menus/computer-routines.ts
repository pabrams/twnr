import { ClientMsgType, ServerMsgType } from '@twnr/shared';
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
} from '../display-computer.js';
import { indexToLetter, letterToIndex } from '../display-starbase.js';
import { registerRoutine } from './types.js';
import { askChar, askNumber, awaitResponse } from './prompts.js';

/**
 * Routines for the computer menu. Most commands are pure transitions or
 * fire-and-forget messages; a couple are local renderers (trader list,
 * current-ship specs, known-universe sector listings) that run entirely
 * client-side from cached state. `back` and `help_menu` come from
 * common-routines.ts.
 */

// Known Universe: askChar between explored/unexplored, send VisitedSectors
// per pick, render the response inline. Server has no menu state for this —
// the player remains in the computer menu the whole time.
registerRoutine('known_universe', async (ctx) => {
    while (true) {
        const ch = await askChar(ctx, render(COMPUTER.knownUniversePrompt), ['e', 'u']);
        if (ch === null) return;
        const mode = ch === 'e' ? 'explored' : 'unexplored';
        ctx.io.sendMsg({ type: ClientMsgType.VisitedSectors });
        const response = await awaitResponse(ctx, [
            ServerMsgType.VisitedSectorsResult,
            ServerMsgType.Error,
        ]);
        if (response === null) return;
        if (response.type !== ServerMsgType.VisitedSectorsResult) return;
        renderVisitedSectorsResult(ctx, response, mode);
    }
});

registerRoutine('trader_list', (ctx) => {
    showTraderList(ctx);
});

// Ship catalog & planet specs: pure client-side info viewers backed by the
// cached catalog data. Render the list once, then loop on letter / `?` /
// Q until the user exits. The dedicated server-side menus (Menu.ShipCatalog,
// Menu.PlanetSpecs) were retired — there's no server state for these views.
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
