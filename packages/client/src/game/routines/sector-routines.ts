import { Menu, type AcceptedReply, Commands, command } from '@twnr/shared';
import { render } from '../renderer.js';
import { COMPUTER, EVENT, NOTIFY, PANEL, PLANET, PORT, SECTOR } from '../messages/index.js';
import {
    echoCommand,
    echoMenuCommand,
    closeMoveMenu,
    showMoveMenu,
    showPortMenu,
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
    askLineRaw,
    askLineWithShortcuts,
    askNumber,
} from './prompts.js';
import { awaitResponse, request } from './io.js';
import { ensureHardwareCatalog } from './catalogs.js';
import { renderAttributeChange } from '../handlers/utils.js';
import { runDockFlow } from '../handlers/port.js';
import { showLanded } from '../handlers/planet.js';

registerRoutine('displaySector', (ctx) => {
    echoCommand(ctx, 'sectorDisplay');
    ctx.io.sendMsg(command(Commands.SectorDisplay, {}));
});

registerRoutine('move', (ctx, line) => {
    const sector = parseInt(line, 10);
    if (!Number.isFinite(sector)) return;
    echoCommand(ctx, 'move', { sector });
    ctx.io.sendMsg(command(Commands.Move, { sector }));
});

registerRoutine('movePrevious', (ctx) => {
    echoCommand(ctx, 'moveToPrevious');
    ctx.io.sendMsg(command(Commands.MoveToPrevious, {}));
});

registerRoutine('moveMenu', async (ctx) => {
    const warps = ctx.world.currentWarps.slice(0, 6);
    if (warps.length === 0) return;
    echoCommand(ctx, 'moveMenu');
    showMoveMenu(ctx);
    const allowed = warps.map((_, i) => String(i + 1));
    const ch = await askChar(ctx, render(SECTOR.moveMenuPrompt, { max: warps.length }), allowed);
    closeMoveMenu(ctx);
    if (ch === null) return;
    const idx = parseInt(ch, 10) - 1;
    const target = warps[idx];
    if (!target) return;
    echoCommand(ctx, 'move', { sector: target.sector });
    ctx.io.sendMsg(command(Commands.Move, { sector: target.sector }));
});

registerRoutine('portMenu', async (ctx) => {
    echoCommand(ctx, 'portInfo');
    showPortMenu(ctx);
    if (!ctx.world.currentPort) return;
    const ch = await askChar(ctx, '', ['t', 's', 'q']);
    if (ch === null || ch === 'q') return;
    if (ch === 't') {
        if (ctx.world.currentPort.class === 9) return;
        const res = await request(ctx, Commands.Dock, {});
        if (res) await runDockFlow(ctx, res);
        return;
    }
    if (ch === 's') {
        if (ctx.world.currentPort.class !== 9) return;
        ctx.io.sendMsg(command(Commands.DockStarbase, {}));
    }
});

registerRoutine('playerInfo', async (ctx) => {
    echoCommand(ctx, 'shipInfo');
    await ensureHardwareCatalog(ctx);
    ctx.io.sendMsg(command(Commands.ShipInfo, {}));
});

registerRoutine('attackMenu', (ctx) => {
    echoCommand(ctx, 'attack');
    ctx.io.sendMsg(command(Commands.AttackTargets, {}));
});

registerRoutine('computerMenu', (ctx) => {
    echoCommand(ctx, 'computer');
    ctx.world.mode = Menu.Computer;
});

registerRoutine('deployDronesInfo', async (ctx) => {
    echoCommand(ctx, 'deployDronesInfo');
    const reply = await request(ctx, Commands.DeployDronesInfo, {});
    if (!reply) return;
    if (reply.outcome === 'noShip') {
        ctx.io.term.writeln(render(EVENT.noShip));
        return;
    }
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
    ctx.io.sendMsg(command(Commands.DeployDrones, { quantity: qty, ownership }));
});

registerRoutine('orderStarport', async (ctx) => {
    echoCommand(ctx, 'orderStarport');
    const info = await request(ctx, Commands.ConstructPortInfo, {});
    if (info === null) return;
    switch (info.outcome) {
        case 'noPlanet':
            ctx.io.term.writeln('');
            ctx.io.term.writeln(render(PORT.constructNoPlanet));
            return;
        case 'build':
            await runBuildFlow(ctx, info);
            return;
        case 'upgrade':
            await runUpgradeFlow(ctx, info);
            return;
    }
});

async function runBuildFlow(
    ctx: Parameters<Parameters<typeof registerRoutine>[1]>[0],
    info: Extract<AcceptedReply<'ConstructPortInfo'>, { outcome: 'build' }>,
): Promise<void> {
    const { term } = ctx.io;
    term.writeln('');
    term.writeln(render(PORT.constructTitle));
    term.writeln(render(PORT.constructColumns));
    term.writeln(render(PORT.constructRule));
    for (const row of info.classes) {
        const credits = row.credits.toLocaleString();
        const code = row.code;
        const fmtCode = `${code[0]}    ${code[1]}    ${code[2]}`;
        term.writeln(
            render(PORT.constructRow, {
                portClass: row.portClass,
                code: fmtCode,
                credits: credits.padStart(7),
                ore: String(row.ore).padStart(4),
                org: String(row.org).padStart(4),
                equ: String(row.equ).padStart(4),
                days: String(row.days).padStart(4),
            }),
        );
    }
    term.writeln('');
    term.writeln(render(PORT.constructProduces, { rate: info.initialProductivity }));
    term.writeln(render(PORT.youHaveCredits, { credits: info.credits.toLocaleString() }));
    if (info.existingConstruction) {
        const ec = info.existingConstruction;
        term.writeln('');
        term.writeln(
            render(PORT.constructUnderway, {
                name: ec.portName,
                class: ec.portClass,
                done: ec.daysCompleted,
                total: ec.daysRequired,
            }),
        );
        return;
    }

    const classChoice = await askChar(ctx, render(PORT.constructClassPrompt), [
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        'q',
    ]);
    if (classChoice === null || classChoice === 'q') return;
    const portClass = parseInt(classChoice, 10);
    const chosen = info.classes.find((c) => c.portClass === portClass);
    if (!chosen) return;

    term.writeln('');
    term.writeln(
        render(PORT.constructClassCost, {
            class: chosen.portClass,
            credits: chosen.credits.toLocaleString(),
        }),
    );
    term.writeln(render(PORT.constructPlanetProduces));
    term.writeln(
        render(PORT.constructDailyRow, {
            qty: chosen.dailyOre,
            commodity: 'Ore',
            days: chosen.days,
        }),
    );
    term.writeln(
        render(PORT.constructDailyRow, {
            qty: chosen.dailyOrg,
            commodity: 'Organics',
            days: chosen.days,
        }),
    );
    term.writeln(
        render(PORT.constructDailyRow, {
            qty: chosen.dailyEqu,
            commodity: 'Equipment',
            days: chosen.days,
        }),
    );
    const confirm = await askConfirm(ctx, render(PORT.constructConfirmPrompt), {
        defaultValue: false,
    });
    if (!confirm) return;

    term.writeln(render(PORT.constructNamePrompt));
    const name = await askLine(ctx, '[---------------------------------------]\r\n');
    if (name === null) return;
    const trimmed = name.trim();
    if (trimmed.length === 0) return;

    const result = await request(ctx, Commands.BuildPort, { portClass, portName: trimmed });
    if (!result) return;
    if (result.outcome === 'started') {
        term.writeln(render(PORT.buildExpGained, { exp: result.experienceGained }));
        term.writeln(render(PORT.buildAlignmentUp, { rep: result.reputationGained }));
        term.writeln(render(PORT.buildUnderway, { days: result.daysRequired }));
    }
}

async function runUpgradeFlow(
    ctx: Parameters<Parameters<typeof registerRoutine>[1]>[0],
    info: Extract<AcceptedReply<'ConstructPortInfo'>, { outcome: 'upgrade' }>,
): Promise<void> {
    const { term } = ctx.io;
    term.writeln('');
    term.writeln(render(PORT.upgradeTag));
    term.writeln(render(PORT.upgradeTitle));
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
        render(PORT.upgradeRow, {
            i,
            label: label.padEnd(11),
            cost: unitCost,
            action,
            prod,
            max,
            stock,
            pct: tradingPct,
        });
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
    term.writeln(render(PORT.youHaveCredits, { credits: info.credits.toLocaleString() }));
    const choice = await askChar(ctx, render(PORT.upgradeChoosePrompt), ['1', '2', '3', 'q']);
    if (choice === null || choice === 'q') return;
    const idx = parseInt(choice, 10) - 1;
    const c = info.commodities[idx];
    if (!c) return;

    const affordable = Math.floor(info.credits / c.unitCost);
    if (affordable <= 0) {
        term.writeln(render(PORT.upgradeInsufficient, { label: labels[idx], cost: c.unitCost }));
        return;
    }
    term.writeln('');
    term.writeln(render(PORT.upgradeCostPerUnit, { cost: c.unitCost, label: labels[idx] }));
    const units = await askNumber(ctx, render(PORT.upgradeUnitsPrompt, { max: affordable }), {
        min: 0,
        defaultValue: 0,
    });
    if (units === null || units <= 0) return;
    const clamped = Math.min(units, affordable);

    const result = await request(ctx, Commands.UpgradePort, {
        commodity: c.commodity,
        units: clamped,
    });
    if (!result) return;
    if (result.outcome === 'upgraded') {
        term.writeln(render(PORT.upgradeExpGained, { exp: result.experienceGained }));
        term.writeln(render(PORT.buildAlignmentUp, { rep: result.reputationGained }));
        term.writeln(render(PORT.upgradeComplete));
    }
}

registerRoutine('jettisonMenu', async (ctx) => {
    echoCommand(ctx, 'jettison');
    const ok = await askConfirm(ctx, render(SECTOR.jettisonConfirm), { defaultValue: false });
    if (ok) {
        ctx.io.sendMsg(command(Commands.Jettison, {}));
    }
});

registerRoutine('handleMinesMenu', async (ctx) => {
    const typeChar = await askChar(ctx, render(EVENT.mineTypePrompt), ['p', 'l']);
    if (typeChar === null) return;
    const mineType: 'proximity' | 'seeker' = typeChar === 'p' ? 'proximity' : 'seeker';

    const info = await request(ctx, Commands.DeployMineInfo, { mineType });
    if (!info) return;

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
    ctx.io.sendMsg(command(Commands.DeployMine, { mineType, quantity: qty, ownership }));
});

registerRoutine('mineDisruptorMenu', async (ctx) => {
    const target = await askNumber(ctx, render(EVENT.disruptorTargetPrompt), {
        min: 1,
    });
    if (target === null) return;
    ctx.io.sendMsg(command(Commands.MineDisruptor, { targetSector: target }));
});

registerRoutine('longRangeScan', async (ctx) => {
    const reply = await request(ctx, Commands.DensityScan, {});
    if (!reply) return;
    if (!reply.hasVisualScanner) return;
    const ok = await askConfirm(ctx, render(PANEL.visualScanPrompt), { defaultValue: false });
    if (!ok) return;
    ctx.io.sendMsg(command(Commands.VisualScan, {}));
});

registerRoutine('releaseBeacon', async (ctx) => {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(SECTOR.beaconBanner));
    const ok = await askConfirm(ctx, render(SECTOR.beaconLaunchPrompt), { defaultValue: false });
    if (!ok) return;
    ctx.io.term.write(render(SECTOR.beaconMessagePrompt));
    const message = await askLine(ctx, '');
    if (message === null) return;
    const reply = await request(ctx, Commands.ReleaseBeacon, { message: message.slice(0, 41) });
    if (!reply) return;
    ctx.io.term.writeln(render(SECTOR.beaconLaunched));
    if (reply.outcome === 'collision') {
        ctx.io.term.writeln(render(SECTOR.beaconCollision));
    }
});

registerRoutine('land', async (ctx) => {
    echoCommand(ctx, 'land');
    const response = await request(ctx, Commands.SectorPlanets, {});
    if (response === null) return;
    if (response.outcome === 'landed') {
        showLanded(ctx, response);
        return;
    }
    const planets = response.planets;
    if (planets.length === 0) {
        ctx.io.term.writeln(render(EVENT.noPlanetsToLand));
        return;
    }
    showPlanetSelectMenu(ctx, planets);

    const byRegistry = new Map(planets.map((p) => [p.registryNumber, p]));
    let chosen: (typeof planets)[number] | undefined;
    while (chosen === undefined) {
        const n = await askNumber(ctx, render(PLANET.planetSelectPrompt));
        if (n === null) return;
        chosen = byRegistry.get(n);
        if (chosen === undefined) {
            ctx.io.term.writeln(render(PLANET.planetSelectNoSuchRegistry));
        }
    }
    echoCommand(ctx, 'landOnPlanet');
    ctx.io.sendMsg(command(Commands.LandOnPlanet, { planetId: chosen.id }));
});

registerRoutine('useTerraformDevice', async (ctx) => {
    echoCommand(ctx, 'terraformInfo');
    const info = await request(ctx, Commands.TerraformInfo, {});
    if (!info) return;
    ctx.io.term.writeln(render(EVENT.terraformDevicesAvailable, { count: info.devices }));
    const ok = await askConfirm(ctx, render(EVENT.terraformConfirm), { defaultValue: false });
    if (!ok) return;

    const result = await request(ctx, Commands.UseTerraformDevice, {});
    if (!result) return;
    const planet = result.planet;
    ctx.io.term.writeln(render(EVENT.terraformNarrative));
    if (result.collision) ctx.io.term.writeln(render(EVENT.terraformCollision));
    renderAttributeChange(ctx, result.expDelta ?? 0, result.repDelta ?? 0, 'creating a planet');

    const typeLabel = planet.displayType ?? planet.type;
    const rawName = await askLineRaw(ctx, render(EVENT.terraformNamePrompt, { type: typeLabel }));
    const name = rawName === null || rawName === '' ? planet.name : rawName;
    let ownership: 'personal' | 'clan' = 'personal';
    if (ctx.player.clanId !== null) {
        const ch = await askChar(ctx, render(EVENT.terraformOwnershipPrompt), ['c', 'p'], {
            defaultChar: 'p',
        });
        ownership = ch === 'c' ? 'clan' : 'personal';
    }
    const setRes = await request(ctx, Commands.SetTerraformedPlanet, {
        planetId: planet.id,
        name,
        ownership,
    });
    if (!setRes) return;
    ctx.io.term.writeln(render(EVENT.terraformConfirmed, { name: setRes.name }));
    ctx.io.term.writeln(
        render(EVENT.terraformDevicesRemaining, { count: result.terraformDevices }),
    );
});

registerRoutine('starbaseInfo', (ctx) => {
    echoCommand(ctx, 'starbaseInfo');
    ctx.io.sendMsg(command(Commands.StarbaseInfo, {}));
});

registerRoutine('quitGame', async (ctx) => {
    echoCommand(ctx, 'quit');
    const ok = await askConfirm(ctx, render(NOTIFY.quitConfirm), { defaultValue: false });
    if (ok) {
        ctx.io.term.writeln(render(NOTIFY.goodbye));
        ctx.io.ws.close();
    }
});

registerRoutine('playersOnline', (ctx) => {
    echoCommand(ctx, 'playersOnline');
    ctx.io.sendMsg(command(Commands.PlayersOnline, {}));
});

registerRoutine('clanMenu', (ctx) => {
    echoMenuCommand(ctx, 'clanMenu');
    ctx.world.mode = Menu.Clan;
});

registerRoutine('transporterPad', async (ctx) => {
    echoCommand(ctx, 'transporterPad');

    const fetchScan = () => request(ctx, Commands.ListOwnedShips, {});
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
            const detail = await request(ctx, Commands.ShipDetail, { shipId: target.id });
            if (!detail) continue;
            await ensureHardwareCatalog(ctx);
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

        ctx.io.sendMsg(command(Commands.TransportToShip, { shipId: target.id }));
        const result = await awaitResponse(ctx, [Commands.TransportToShip.reply.name]);
        if (result === null) return;
        if (result.type !== Commands.TransportToShip.reply.name) continue;

        ctx.world.currentSector = result.targetSector;
        ctx.io.term.writeln('');
        ctx.io.term.writeln(render(COMPUTER.transporterSuccess));
        ctx.io.term.writeln('');
        ctx.io.term.writeln(
            render(COMPUTER.transporterTurnsLeft, { turns: result.turnsRemaining }),
        );
        const refreshed = await fetchScan();
        if (!refreshed) return;
        scan = refreshed;
        paintScan(scan);
    }
});

registerRoutine('towSpacecraft', async (ctx) => {
    echoCommand(ctx, 'towSpacecraft');
    const reply = await request(ctx, Commands.TowSpacecraft, {});
    if (!reply) return;

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
        const attach = await request(ctx, Commands.TowAttach, { shipId });
        if (!attach) return;
        ctx.io.term.writeln(
            render(EVENT.towEngaged, { name: attach.targetName, tpw: attach.turnsPerWarp }),
        );
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

    void viewerId;
});
