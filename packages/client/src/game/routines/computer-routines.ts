import { ClientTag, ServerTag } from '@twnr/shared';
import { render } from '../renderer.js';
import { COMPUTER, EVENT, NOTIFY } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { renderMailEntries } from '../display-mail.js';
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
import { askChar, askConfirm, askLine, askMultiLine, askNumber } from './prompts.js';
import { request } from './io.js';

registerRoutine('known_universe', async (ctx) => {
    while (true) {
        const ch = await askChar(ctx, render(COMPUTER.knownUniversePrompt), ['e', 'u']);
        if (ch === null) return;
        const mode = ch === 'e' ? 'explored' : 'unexplored';
        const response = await request(
            ctx,
            { type: ClientTag.VisitedSectors },
            ServerTag.VisitedSectorsResult,
        );
        if (!response) return;
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
    const response = await request(
        ctx,
        { type: ClientTag.ListOwnedShips },
        ServerTag.ListOwnedShipsResult,
    );
    if (!response) return;
    renderActiveShipScan(ctx, response);
});

registerRoutine('change_ship_ownership', async (ctx) => {
    echoCommand(ctx, 'changeShipOwnership');
    const ch = await askChar(ctx, render(COMPUTER.ownershipPrompt), ['p', 'c']);
    if (ch === null) return;
    const ownership = ch === 'p' ? 'personal' : 'clan';
    const result = await request(
        ctx,
        { type: ClientTag.ChangeShipOwnership, ownership },
        ServerTag.ChangeShipOwnershipResult,
    );
    if (!result) return;
    ctx.io.term.writeln(
        render(
            result.ownership === 'clan'
                ? COMPUTER.ownershipResultClan
                : COMPUTER.ownershipResultPersonal,
        ),
    );
});

registerRoutine('read_mail', async (ctx) => {
    echoCommand(ctx, 'readMail');
    const reply = await request(ctx, { type: ClientTag.ReadMail }, ServerTag.MemoDelivery);
    if (!reply) return;
    if (reply.memos.length === 0) {
        ctx.io.term.writeln(render(EVENT.mailReadEmpty));
        return;
    }
    renderMailEntries(ctx, reply.memos);
    const del = await askConfirm(ctx, render(EVENT.mailDeletePrompt), { defaultValue: false });
    if (del) ctx.io.sendMsg({ type: ClientTag.DeleteAllMail });
});

registerRoutine('hail', async (ctx) => {
    echoCommand(ctx, 'hail');
    ctx.io.term.writeln(render(EVENT.hailWhoPrompt));
    const target = await askLine(ctx, render(EVENT.hailNamePrompt));
    if (target === null) return;
    ctx.io.term.writeln(render(EVENT.hailRequesting, { name: target }));
    const resolved = await request(
        ctx,
        { type: ClientTag.HailResolve, name: target },
        ServerTag.HailResolveResult,
    );
    if (!resolved) return;
    if (resolved.outcome === 'notFound') {
        ctx.io.term.writeln(render(EVENT.hailNotFound));
        return;
    }
    if (resolved.outcome === 'ambiguous') {
        ctx.io.term.writeln(render(EVENT.hailAmbiguous, { matches: resolved.matches.join(', ') }));
        return;
    }
    if (resolved.outcome === 'self') {
        ctx.io.term.writeln(render(EVENT.hailSelf));
        return;
    }
    const online = resolved.online;
    if (online) {
        ctx.io.term.writeln(render(EVENT.hailEstablished));
        ctx.io.term.writeln(render(EVENT.hailTypePrivateBanner));
    } else {
        ctx.io.term.writeln(render(EVENT.hailNotResponding, { name: resolved.recipientName }));
        ctx.io.term.writeln(render(EVENT.hailReroutingMail));
        ctx.io.term.writeln(render(EVENT.hailTypeMailBanner));
    }
    const linePrompt = online
        ? render(EVENT.hailLinePromptOnline)
        : render(EVENT.hailLinePromptOffline);
    const body = await askMultiLine(ctx, linePrompt);
    if (body === null || body.trim() === '') {
        ctx.io.term.writeln(render(EVENT.hailEmpty));
        return;
    }
    const sendResult = await request(
        ctx,
        { type: ClientTag.HailSend, recipientPlayerId: resolved.recipientPlayerId, body },
        ServerTag.HailSendResult,
    );
    if (!sendResult) return;
    if (sendResult.outcome === 'delivered') {
        ctx.io.term.writeln(render(EVENT.hailTerminated));
    } else if (sendResult.outcome === 'queued') {
        ctx.io.term.writeln(render(EVENT.hailQueued));
    }
});
