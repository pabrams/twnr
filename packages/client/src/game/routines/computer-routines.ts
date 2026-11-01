import { Commands, command } from '@twnr/shared';
import { render } from '../renderer.js';
import { COMPUTER, EVENT, NEWS, NOTIFY } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { renderMailEntries } from '../display-mail.js';
import { formatStardate, parseStardate, startOfUtcDay } from '../display-news.js';
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
import { askChar, askConfirm, askLine, askLineRaw, askMultiLine, askNumber } from './prompts.js';
import { request } from './io.js';
import { loadPlanetCatalog, loadShipCatalog } from './catalogs.js';
import { showGalacticNews } from './news.js';

registerRoutine('knownUniverse', async (ctx) => {
    while (true) {
        const ch = await askChar(ctx, render(COMPUTER.knownUniversePrompt), ['e', 'u']);
        if (ch === null) return;
        const mode = ch === 'e' ? 'explored' : 'unexplored';
        const response = await request(ctx, Commands.VisitedSectors, {});
        if (!response) return;
        renderVisitedSectorsResult(ctx, response, mode);
    }
});

registerRoutine('traderList', async (ctx) => {
    ctx.io.term.writeln(render(COMPUTER.traderListLoading));
    const reply = await request(ctx, Commands.TraderList, {});
    if (!reply) return;
    showTraderList(ctx, reply.traders);
});

registerRoutine('shipCatalog', async (ctx) => {
    const ships = await loadShipCatalog(ctx);
    if (!ships || ships.length === 0) return;
    showShipCatalog(ctx, ships);
    const letters = ships.map((_, i) => indexToLetter(i).toLowerCase());
    const allowed = [...letters, '?'];
    while (true) {
        const ch = await askChar(ctx, render(COMPUTER.shipInterestPrompt), allowed);
        if (ch === null) return;
        if (ch === '?') {
            showShipCatalog(ctx, ships);
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

registerRoutine('planetSpecs', async (ctx) => {
    const planets = await loadPlanetCatalog(ctx);
    if (!planets || planets.length === 0) return;
    showPlanetSpecs(ctx, planets);
    const letters = planets.map((_, i) => indexToLetter(i).toLowerCase());
    const allowed = [...letters, '?'];
    while (true) {
        const ch = await askChar(ctx, render(COMPUTER.planetSpecsPrompt), allowed);
        if (ch === null) return;
        if (ch === '?') {
            showPlanetSpecs(ctx, planets);
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

registerRoutine('currentShipSpecs', async (ctx) => {
    const ships = await loadShipCatalog(ctx);
    if (!ships) return;
    showCurrentShipSpecs(ctx, ships);
});

registerRoutine('hyperspaceJump', async (ctx) => {
    const sector = await askNumber(ctx, render(COMPUTER.hyperspaceTargetPrompt), {
        min: 1,
    });
    if (sector === null) return;
    echoCommand(ctx, 'hyperspaceJump');
    ctx.io.sendMsg(command(Commands.HyperspaceJump, { targetSector: sector }));
});

registerRoutine('listPlanets', (ctx) => {
    echoCommand(ctx, 'listPlanets');
    ctx.io.sendMsg(command(Commands.ListPlanets, {}));
});

registerRoutine('trackSeekerMines', (ctx) => {
    ctx.io.sendMsg(command(Commands.TrackSeekerMines, {}));
});

registerRoutine('listDeployedMines', async (ctx) => {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(COMPUTER.mineScanBanner));
    ctx.io.term.writeln('');
    const ch = await askChar(ctx, render(COMPUTER.mineScanPrompt), ['p', 'l']);
    if (ch === null) {
        ctx.world.mineScanFilter = null;
        return;
    }
    ctx.world.mineScanFilter = ch === 'p' ? 'proximity' : 'seeker';
    ctx.io.sendMsg(command(Commands.ListDeployedMines, {}));
});

registerRoutine('activeShipScan', async (ctx) => {
    echoCommand(ctx, 'activeShipScan');
    const response = await request(ctx, Commands.ListOwnedShips, {});
    if (!response) return;
    renderActiveShipScan(ctx, response);
});

registerRoutine('changeShipOwnership', async (ctx) => {
    echoCommand(ctx, 'changeShipOwnership');
    const ch = await askChar(ctx, render(COMPUTER.ownershipPrompt), ['p', 'c']);
    if (ch === null) return;
    const ownership = ch === 'p' ? 'personal' : 'clan';
    const result = await request(ctx, Commands.ChangeShipOwnership, { ownership });
    if (!result) return;
    ctx.io.term.writeln(
        render(
            result.ownership === 'clan'
                ? COMPUTER.ownershipResultClan
                : COMPUTER.ownershipResultPersonal,
        ),
    );
});

registerRoutine('readMail', async (ctx) => {
    echoCommand(ctx, 'readMail');
    const reply = await request(ctx, Commands.ReadMail, {});
    if (!reply) return;
    if (reply.memos.length === 0) {
        ctx.io.term.writeln(render(EVENT.mailReadEmpty));
        return;
    }
    renderMailEntries(ctx, reply.memos);
    const del = await askConfirm(ctx, render(EVENT.mailDeletePrompt), { defaultValue: false });
    if (del) ctx.io.sendMsg(command(Commands.DeleteAllMail, {}));
});

registerRoutine('galacticNews', async (ctx) => {
    echoCommand(ctx, 'galacticNews');
    const range = await request(ctx, Commands.GalacticNewsRange, {});
    if (!range) return;
    if (range.earliestCreatedAt === null) {
        ctx.io.term.writeln(render(NEWS.noNewsYet));
        return;
    }
    const today = startOfUtcDay(new Date());
    const earliest = startOfUtcDay(new Date(range.earliestCreatedAt));
    const dateVars = { today: formatStardate(today), earliest: formatStardate(earliest) };
    ctx.io.term.writeln(render(NEWS.dateIntro, dateVars));
    while (true) {
        const line = await askLineRaw(ctx, render(NEWS.datePrompt, dateVars));
        if (line === null || line.toLowerCase() === 'q') return;
        if (line === '') {
            await showGalacticNews(ctx, today);
            return;
        }
        const from = parseStardate(line);
        if (from !== null && from >= earliest && from <= today) {
            await showGalacticNews(ctx, from);
            return;
        }
        ctx.io.term.writeln(render(NEWS.dateInvalid, dateVars));
    }
});

registerRoutine('hail', async (ctx) => {
    echoCommand(ctx, 'hail');
    ctx.io.term.writeln(render(EVENT.hailWhoPrompt));
    const target = await askLine(ctx, render(EVENT.hailNamePrompt));
    if (target === null) return;
    ctx.io.term.writeln(render(EVENT.hailRequesting, { name: target }));
    const resolved = await request(ctx, Commands.HailResolve, { name: target });
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
    const sendResult = await request(ctx, Commands.HailSend, {
        recipientPlayerId: resolved.recipientPlayerId,
        body,
    });
    if (!sendResult) return;
    if (sendResult.outcome === 'delivered') {
        ctx.io.term.writeln(render(EVENT.hailTerminated));
    } else if (sendResult.outcome === 'queued') {
        ctx.io.term.writeln(render(EVENT.hailQueued));
    }
});
