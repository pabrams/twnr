import { ClientTag, Menu, ServerTag, type ServerEnvelope as ServerEnvelopeT } from '@twnr/shared';
import { render } from '../renderer.js';
import { COMPUTER, EVENT, NOTIFY, PANEL, PLANET, SECTOR } from '../messages/index.js';
import {
    echoCommand,
    echoMenuCommand,
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
    askLine,
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

registerRoutine('deploy_drones_info', async (ctx) => {
    echoCommand(ctx, 'deployDronesInfo');
    ctx.io.sendMsg({ type: ClientTag.DeployDronesInfo });
    const reply = await awaitResponse(ctx, [ServerTag.DeployDronesInfoResult, ServerTag.Error]);
    if (reply === null) return;
    if (reply.type !== ServerTag.DeployDronesInfoResult) return;
    const total = reply.shipDrones + reply.sectorDrones;
    const minInSector = Math.max(0, total - reply.shipMaxDrones);
    ctx.io.term.writeln('');
    ctx.io.term.writeln(
        render(EVENT.deployDronesInfo, {
            total,
            max: reply.shipMaxDrones,
            minInSector,
        }),
    );
    const qty = await askNumber(ctx, render(EVENT.deployDronesPrompt, { minInSector }), {
        min: 0,
        defaultValue: -1,
    });
    if (qty === null) return;
    const ownership = await askDeployOwnership(ctx, render(EVENT.deployOwnershipPrompt));
    if (ownership === null) return;
    ctx.io.sendMsg({ type: ClientTag.DeployDrones, quantity: qty, ownership });
});

registerRoutine('order_starport', async (ctx) => {
    echoCommand(ctx, 'orderStarport');
    ctx.io.sendMsg({ type: ClientTag.ConstructPortInfo });
    const info = await awaitResponse(ctx, [
        ServerTag.ConstructPortInfoResult,
        ServerTag.UpgradePortInfoResult,
        ServerTag.Error,
    ]);
    if (info === null) return;

    if (info.type === ServerTag.ConstructPortInfoResult) {
        if (info.mode === 'hasPort') {
            ctx.io.term.writeln('');
            ctx.io.term.writeln('There is already a port in this sector.');
            return;
        }
        if (info.mode === 'noPlanet') {
            ctx.io.term.writeln('');
            ctx.io.term.writeln(
                'You need a planet in this sector before you can construct a port.',
            );
            return;
        }
        if (info.mode === 'build') {
            await runBuildFlow(ctx, info);
            return;
        }
    }
    if (info.type === ServerTag.UpgradePortInfoResult) {
        if (info.mode === 'noPort') {
            ctx.io.term.writeln('');
            ctx.io.term.writeln('No port here to upgrade.');
            return;
        }
        await runUpgradeFlow(ctx, info);
    }
});

async function runBuildFlow(
    ctx: Parameters<Parameters<typeof registerRoutine>[1]>[0],
    info: Extract<
        ServerEnvelopeT,
        { type: typeof ServerTag.ConstructPortInfoResult; mode: 'build' }
    >,
): Promise<void> {
    const { term } = ctx.io;
    term.writeln('');
    term.writeln('   StarPort Construction          Initial Construction Costs');
    term.writeln(' Port Class   Ore  Org  Equ    Credits  Ore  Org  Equ  Days');
    term.writeln(' ---------- - --- --- ----   --------- ---- ---- ---- ----');
    for (const row of info.classes) {
        const credits = row.credits.toLocaleString();
        const code = row.code;
        const fmtCode = `${code[0]}    ${code[1]}    ${code[2]}`;
        term.writeln(
            `     ${row.portClass}      ${fmtCode}   ` +
                `${credits.padStart(7)} ${String(row.ore).padStart(4)} ` +
                `${String(row.org).padStart(4)} ${String(row.equ).padStart(4)} ` +
                `${String(row.days).padStart(4)}`,
        );
    }
    term.writeln('');
    term.writeln(
        `Ports will initially produce ${info.initialProductivity} units/day in each category`,
    );
    term.writeln(`You have ${info.credits.toLocaleString()} credits.`);
    if (info.existingConstruction) {
        const ec = info.existingConstruction;
        term.writeln('');
        term.writeln(
            `Note: construction of "${ec.portName}" (Class ${ec.portClass}) is already underway here — ` +
                `${ec.daysCompleted}/${ec.daysRequired} days complete.`,
        );
        return;
    }

    const classChoice = await askChar(
        ctx,
        'What Class of port do you want to build? (1-8, Q to quit) ',
        ['1', '2', '3', '4', '5', '6', '7', '8', 'q'],
    );
    if (classChoice === null || classChoice === 'q') return;
    const portClass = parseInt(classChoice, 10);
    const chosen = info.classes.find((c) => c.portClass === portClass);
    if (!chosen) return;

    term.writeln('');
    term.writeln(
        `Port Class ${chosen.portClass} will require ${chosen.credits.toLocaleString()} credits.`,
    );
    term.writeln('A Planet capable of producing the following per day:');
    term.writeln(`${chosen.dailyOre} units of Ore/day for ${chosen.days} days`);
    term.writeln(`${chosen.dailyOrg} units of Organics/day for ${chosen.days} days`);
    term.writeln(`${chosen.dailyEqu} units of Equipment/day for ${chosen.days} days`);
    const confirm = await askConfirm(ctx, 'Do you want to initiate construction on this port? ', {
        defaultValue: false,
    });
    if (!confirm) return;

    term.writeln('What do you want to name this StarPort?');
    const name = await askLine(ctx, '[---------------------------------------]\r\n');
    if (name === null) return;
    const trimmed = name.trim();
    if (trimmed.length === 0) return;

    ctx.io.sendMsg({ type: ClientTag.BuildPort, portClass, portName: trimmed });
    const result = await awaitResponse(ctx, [ServerTag.BuildPortResult, ServerTag.Error]);
    if (result === null) return;
    if (result.type === ServerTag.BuildPortResult) {
        if (result.outcome === 'started') {
            term.writeln(
                `For building this Starport, you receive ${result.experienceGained} experience point(s).`,
            );
            term.writeln(`and your alignment went up by ${result.reputationGained} point(s).`);
            term.writeln(
                `Construction underway. Daily advances will be reported by mail (${result.daysRequired} days total).`,
            );
        } else {
            term.writeln(`Construction failed: ${result.message}`);
        }
    }
}

async function runUpgradeFlow(
    ctx: Parameters<Parameters<typeof registerRoutine>[1]>[0],
    info: Extract<
        ServerEnvelopeT,
        { type: typeof ServerTag.UpgradePortInfoResult; mode: 'upgrade' }
    >,
): Promise<void> {
    const { term } = ctx.io;
    term.writeln('');
    term.writeln('(Upgrade StarPort)');
    term.writeln('   Upgrade Starport Production');
    const fmtRow = (
        i: number,
        label: string,
        unitCost: number,
        action: string,
        prod: number,
        max: number,
        stock: number,
        tradingPct: number,
    ) =>
        ` ${i} ${label.padEnd(11)} costs $${unitCost}/unit   ` +
        `(${action}, prod=${prod}, max=${max}, stock=${stock}, ${tradingPct}%)`;
    const labels = ['Fuel Ore', 'Organics', 'Equipment'];
    for (let i = 0; i < info.commodities.length; i++) {
        const c = info.commodities[i];
        term.writeln(
            fmtRow(
                i + 1,
                labels[i],
                c.unitCost,
                c.action,
                c.currentProd,
                c.currentMax,
                c.currentStock,
                c.currentTradingPct,
            ),
        );
    }
    term.writeln(`You have ${info.credits.toLocaleString()} credits.`);
    const choice = await askChar(ctx, 'Choose 1, 2, 3 or Q to quit ', ['1', '2', '3', 'q']);
    if (choice === null || choice === 'q') return;
    const idx = parseInt(choice, 10) - 1;
    const c = info.commodities[idx];
    if (!c) return;

    const affordable = Math.floor(info.credits / c.unitCost);
    if (affordable <= 0) {
        term.writeln(
            `Insufficient credits to upgrade ${labels[idx]} (need at least $${c.unitCost}).`,
        );
        return;
    }
    term.writeln('');
    term.writeln(`That will cost ${c.unitCost} per unit to upgrade the ${labels[idx]}`);
    const units = await askNumber(
        ctx,
        `How many units do you want to invest? (${affordable} max, 0 to quit) `,
        {
            min: 0,
            defaultValue: 0,
        },
    );
    if (units === null || units <= 0) return;
    const clamped = Math.min(units, affordable);

    ctx.io.sendMsg({ type: ClientTag.UpgradePort, commodity: c.commodity, units: clamped });
    const result = await awaitResponse(ctx, [ServerTag.UpgradePortResult, ServerTag.Error]);
    if (result === null) return;
    if (result.type === ServerTag.UpgradePortResult) {
        if (result.outcome === 'upgraded') {
            term.writeln(
                `For upgrading this StarPort, you receive ${result.experienceGained} experience point(s).`,
            );
            term.writeln(`and your alignment went up by ${result.reputationGained} point(s).`);
            term.writeln('StarPort upgraded!');
        } else {
            term.writeln(`Upgrade failed: ${result.message}`);
        }
    }
}

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

    const qty = await askNumber(ctx, render(EVENT.handleMinesPrompt, { label }), {
        min: 0,
        defaultValue: -1,
    });
    if (qty === null) return;
    const ownership = await askDeployOwnership(ctx, '\r\nOwnership (P)ersonal, (C)lan, (Q)? ');
    if (ownership === null) return;
    ctx.io.sendMsg({ type: ClientTag.DeployMine, mineType, quantity: qty, ownership });
});

registerRoutine('mine_disruptor_menu', async (ctx) => {
    const target = await askNumber(ctx, 'Mine disruptor — adjacent target sector? (Q to cancel) ', {
        min: 1,
    });
    if (target === null) return;
    ctx.io.sendMsg({ type: ClientTag.MineDisruptor, targetSector: target });
});

registerRoutine('long_range_scan', async (ctx) => {
    ctx.io.sendMsg({ type: ClientTag.DensityScan });
    const reply = await awaitResponse(ctx, [ServerTag.DensityScanResult, ServerTag.Error]);
    if (reply === null) return;
    if (reply.type !== ServerTag.DensityScanResult) return;
    if (!reply.hasVisualScanner) return;
    const ok = await askConfirm(ctx, render(PANEL.visualScanPrompt), { defaultValue: false });
    if (!ok) return;
    ctx.io.sendMsg({ type: ClientTag.VisualScan });
});

registerRoutine('release_beacon', async (ctx) => {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(SECTOR.beaconBanner));
    const ok = await askConfirm(ctx, render(SECTOR.beaconLaunchPrompt), { defaultValue: false });
    if (!ok) return;
    ctx.io.term.write(render(SECTOR.beaconMessagePrompt));
    const message = await askLine(ctx, '');
    if (message === null) return;
    ctx.io.sendMsg({ type: ClientTag.ReleaseBeacon, message: message.slice(0, 41) });
    const reply = await awaitResponse(ctx, [ServerTag.ReleaseBeaconResult, ServerTag.Error]);
    if (reply === null) return;
    if (reply.type !== ServerTag.ReleaseBeaconResult) return;
    if (reply.outcome === 'noBeacons') {
        ctx.io.term.writeln(render(SECTOR.beaconNoBeacons));
        return;
    }
    ctx.io.term.writeln(render(SECTOR.beaconLaunched));
    if (reply.outcome === 'collision') {
        ctx.io.term.writeln(render(SECTOR.beaconCollision));
    }
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
    echoMenuCommand(ctx, 'clan_menu');
    ctx.world.mode = Menu.Clan;
});

registerRoutine('transporter_pad', async (ctx) => {
    echoCommand(ctx, 'transporterPad');

    const fetchScan = async () => {
        ctx.io.sendMsg({ type: ClientTag.ListOwnedShips });
        const reply = await awaitResponse(ctx, [ServerTag.ListOwnedShipsResult, ServerTag.Error]);
        if (reply === null) return null;
        if (reply.type !== ServerTag.ListOwnedShipsResult) return null;
        return reply;
    };
    const paintScan = (s: NonNullable<Awaited<ReturnType<typeof fetchScan>>>) => {
        renderTransporterPrelude(ctx, s);
        renderActiveShipScan(ctx, s, {
            sortByHops: true,
            rangeFromCurrentShip: s.currentShipTransporterRange,
        });
        renderTransporterOptions(ctx);
    };

    let scan = await fetchScan();
    if (!scan) return;
    paintScan(scan);

    while (true) {
        const choice = await askLineWithShortcuts(ctx, render(COMPUTER.transporterPrompt), [
            'i',
            '?',
        ]);
        if (choice === null) return;

        if (choice === '?') {
            paintScan(scan);
            continue;
        }

        if (choice === 'i') {
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
            const detail = await awaitResponse(ctx, [ServerTag.ShipDetailResult, ServerTag.Error]);
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
        const result = await awaitResponse(ctx, [ServerTag.TransportToShipResult, ServerTag.Error]);
        if (result === null) return;
        if (result.type !== ServerTag.TransportToShipResult) continue;

        ctx.world.currentSector = result.targetSector;
        ctx.io.term.writeln('');
        ctx.io.term.writeln(render(COMPUTER.transporterSuccess));
        ctx.io.term.writeln('');
        ctx.io.term.writeln(
            render(COMPUTER.transporterTurnsLeft, { turns: result.turnsRemaining }),
        );
        // Refresh the scan since the player's ship + position changed.
        const refreshed = await fetchScan();
        if (!refreshed) return;
        scan = refreshed;
        paintScan(scan);
    }
});

registerRoutine('tow_spacecraft', async (ctx) => {
    echoCommand(ctx, 'towSpacecraft');
    ctx.io.sendMsg({ type: ClientTag.TowSpacecraft });
    const reply = await awaitResponse(ctx, [ServerTag.TowSpacecraftResult, ServerTag.Error]);
    if (reply === null) return;
    if (reply.type !== ServerTag.TowSpacecraftResult) return;

    if (reply.outcome === 'disengaged') {
        ctx.io.term.writeln(render(EVENT.towDisengaged));
        return;
    }
    if (reply.outcome === 'none') {
        ctx.io.term.writeln(render(EVENT.towNoShips));
        return;
    }

    const { manned, unmanned, sector } = reply;
    const viewerId = ctx.player.id;
    const viewerClanId = ctx.player.clanId;

    const renderClanSuffix = (n: number | null) =>
        n !== null ? render(EVENT.towClanSuffix, { num: n }) : '';

    const renderUnmannedOwnership = (o: (typeof unmanned)[number]['ownership']): string => {
        if (o.kind === 'player') {
            const clanSuffix = renderClanSuffix(o.ownerClanNumber);
            return render(SECTOR.ownershipPlayerOwnedBy, { name: o.name, clanSuffix });
        }
        if (o.kind === 'clan') {
            if (viewerClanId !== null && o.clanId === viewerClanId) {
                return render(SECTOR.ownershipYourClan);
            }
            return render(SECTOR.ownershipClan, { num: o.clanNumber, name: o.name });
        }
        return render(SECTOR.ownershipRogue);
    };

    const finalizeAttach = async (shipId: number) => {
        ctx.io.sendMsg({ type: ClientTag.TowAttach, shipId });
        const attach = await awaitResponse(ctx, [ServerTag.TowAttachResult, ServerTag.Error]);
        if (attach === null) return;
        if (attach.type !== ServerTag.TowAttachResult) return;
        if (attach.outcome === 'ok') {
            ctx.io.term.writeln(
                render(EVENT.towEngaged, { message: attach.message, tpw: attach.turnsPerWarp }),
            );
        } else {
            ctx.io.term.writeln(render(EVENT.towAttachError, { message: attach.message }));
        }
    };

    if (manned.length > 0) {
        const wantManned = await askConfirm(ctx, render(EVENT.towMannedConfirm), {
            defaultValue: false,
        });
        if (wantManned === null) return;
        if (wantManned) {
            ctx.io.term.writeln(render(EVENT.towMannedHeading));
            manned.forEach((p, i) => {
                const clanSuffix = renderClanSuffix(p.clanNumber);
                const tpl = p.shipTypeDisplayName
                    ? EVENT.towMannedItemColored
                    : EVENT.towMannedItemPlain;
                ctx.io.term.writeln(
                    render(tpl, {
                        index: i + 1,
                        name: p.playerName,
                        clanSuffix,
                        drones: p.drones,
                        shipName: p.shipName,
                        shipTypeColored: p.shipTypeDisplayName ?? '',
                        shipType: p.shipTypeName,
                    }),
                );
            });
            if (manned.every((p) => p.drones > 0)) {
                ctx.io.term.writeln(render(EVENT.towCannotMannedWithDrones));
                return;
            }
            const idx = await askNumber(ctx, render(EVENT.towSelectPrompt), {
                min: 1,
                max: manned.length,
            });
            if (idx === null) return;
            const picked = manned[idx - 1];
            if (picked.drones > 0) {
                ctx.io.term.writeln(render(EVENT.towCannotMannedWithDrones));
                return;
            }
            await finalizeAttach(picked.shipId);
            return;
        }
    }

    if (unmanned.length > 0) {
        ctx.io.term.writeln(render(EVENT.towUnmannedHeading, { sector }));
        unmanned.forEach((s, i) => {
            const tpl = s.shipTypeDisplayName
                ? EVENT.towUnmannedItemColored
                : EVENT.towUnmannedItemPlain;
            ctx.io.term.writeln(
                render(tpl, {
                    index: i + 1,
                    shipName: s.shipName,
                    shipTypeColored: s.shipTypeDisplayName ?? '',
                    shipType: s.shipTypeName,
                    ownership: renderUnmannedOwnership(s.ownership),
                    drones: s.drones,
                }),
            );
        });
        const idx = await askNumber(ctx, render(EVENT.towSelectPrompt), {
            min: 1,
            max: unmanned.length,
        });
        if (idx === null) return;
        await finalizeAttach(unmanned[idx - 1].shipId);
        return;
    }

    // Manned existed but answered No, and no unmanned available: silent end.
    void viewerId;
});
