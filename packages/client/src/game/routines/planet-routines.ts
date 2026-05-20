import { ClientTag, Menu, ServerTag } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { PLANET } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { registerRoutine } from './types.js';
import { askChar, askConfirm, askLineWithShortcuts, askNumber, awaitResponse } from './prompts.js';
import { fmt } from '../handlers/utils.js';

type Product3 = 'fuel' | 'organics' | 'equipment';
const PRODUCT_BY_DIGIT: Record<string, Product3> = {
    '1': 'fuel',
    '2': 'organics',
    '3': 'equipment',
};
const PRODUCT_LABEL: Record<Product3, string> = {
    fuel: 'Ore',
    organics: 'Organics',
    equipment: 'Equipment',
};

async function askProductGroup(
    ctx: GameContext,
    promptKey:
        | 'productGroupTakingPrompt'
        | 'productGroupLeavingPrompt'
        | 'colonistGroupChangingPrompt'
        | 'colonistGroupFromPrompt'
        | 'colonistGroupToPrompt',
): Promise<Product3 | null> {
    const ch = await askChar(ctx, render(PLANET[promptKey]), ['1', '2', '3']);
    return ch ? (PRODUCT_BY_DIGIT[ch] ?? null) : null;
}

async function askDisplayPlanet(ctx: GameContext, defaultYes: boolean): Promise<boolean | null> {
    return askConfirm(
        ctx,
        render(PLANET.displayPlanetPrompt, { default: defaultYes ? 'Y' : 'N' }),
        { defaultValue: defaultYes },
    );
}

async function maybeShowPlanet(ctx: GameContext, defaultYes: boolean): Promise<boolean> {
    const show = await askDisplayPlanet(ctx, defaultYes);
    if (show === null) return false;
    if (show) {
        ctx.io.sendMsg({ type: ClientTag.PlanetDisplay });
        await awaitResponse(ctx, [ServerTag.PlanetDisplayResult, ServerTag.Error]);
    }
    return true;
}

registerRoutine('load_unload_colonists', async (ctx) => {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(PLANET.loadUnloadBanner));
    if (!(await maybeShowPlanet(ctx, false))) return;
    const action = await askChar(
        ctx,
        render(PLANET.leaveOrTakeColonistsPrompt, { default: 'L' }),
        ['l', 't'],
        { defaultChar: 'l' },
    );
    if (!action) return;
    const commodity = await askProductGroup(ctx, 'colonistGroupChangingPrompt');
    if (!commodity) return;
    if (action === 't') {
        const qty = await askNumber(
            ctx,
            render(PLANET.colonistQtyTakePrompt, { emptyHolds: ctx.ship.planetEmptyHolds }),
            { defaultValue: -1 },
        );
        if (qty === null) return;
        ctx.io.sendMsg({ type: ClientTag.TakeColonists, quantity: qty, commodity });
    } else {
        const qty = await askNumber(
            ctx,
            render(PLANET.colonistQtyLeavePrompt, { shipColonists: ctx.ship.shipColonists }),
            { defaultValue: -1 },
        );
        if (qty === null) return;
        ctx.io.sendMsg({ type: ClientTag.LeaveColonists, quantity: qty, commodity });
    }
});

function takeDefault(ctx: GameContext, commodity: Product3): number {
    const planet =
        commodity === 'fuel'
            ? ctx.planet.fuel
            : commodity === 'organics'
              ? ctx.planet.organics
              : ctx.planet.equipment;
    return Math.max(0, Math.min(planet, ctx.ship.planetEmptyHolds));
}

function leaveDefault(ctx: GameContext, commodity: Product3): number {
    const onShip =
        commodity === 'fuel'
            ? ctx.ship.shipFuel
            : commodity === 'organics'
              ? ctx.ship.shipOrganics
              : ctx.ship.shipEquipment;
    const planetRoom =
        commodity === 'fuel'
            ? Math.max(0, ctx.planet.maxFuel - ctx.planet.fuel)
            : commodity === 'organics'
              ? Math.max(0, ctx.planet.maxOrg - ctx.planet.organics)
              : Math.max(0, ctx.planet.maxEqu - ctx.planet.equipment);
    return Math.max(0, Math.min(onShip, planetRoom));
}

registerRoutine('take_leave_product', async (ctx) => {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(PLANET.takeLeaveBanner));
    if (!(await maybeShowPlanet(ctx, false))) return;
    const action = await askChar(
        ctx,
        render(PLANET.leaveOrTakeProductPrompt, { default: 'T' }),
        ['l', 't'],
        { defaultChar: 't' },
    );
    if (!action) return;
    const commodity = await askProductGroup(
        ctx,
        action === 't' ? 'productGroupTakingPrompt' : 'productGroupLeavingPrompt',
    );
    if (!commodity) return;
    const label = PRODUCT_LABEL[commodity];
    if (action === 't') {
        const def = takeDefault(ctx, commodity);
        const qty = await askNumber(
            ctx,
            render(PLANET.productQtyTakePrompt, {
                commodity: label,
                emptyHolds: ctx.ship.planetEmptyHolds,
            }),
            { defaultValue: def },
        );
        if (qty === null) return;
        ctx.io.sendMsg({ type: ClientTag.TakeCommodity, quantity: qty, commodity });
    } else {
        const onBoard =
            commodity === 'fuel'
                ? ctx.ship.shipFuel
                : commodity === 'organics'
                  ? ctx.ship.shipOrganics
                  : ctx.ship.shipEquipment;
        const def = leaveDefault(ctx, commodity);
        const qty = await askNumber(
            ctx,
            render(PLANET.productQtyLeavePrompt, { commodity: label, onBoard }),
            { defaultValue: def },
        );
        if (qty === null) return;
        ctx.io.sendMsg({ type: ClientTag.LeaveCommodity, quantity: qty, commodity });
    }
});

registerRoutine('change_population', async (ctx) => {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(PLANET.changePopulationBanner));
    if (!(await maybeShowPlanet(ctx, true))) return;
    const from = await askProductGroup(ctx, 'colonistGroupFromPrompt');
    if (!from) return;
    const qty = await askNumber(ctx, render(PLANET.populationQtyPrompt), { min: 1 });
    if (qty === null) return;
    const to = await askProductGroup(ctx, 'colonistGroupToPrompt');
    if (!to) return;
    if (from === to) {
        ctx.io.term.writeln(render(PLANET.sameGroup));
        return;
    }
    ctx.io.sendMsg({ type: ClientTag.ChangePopulation, quantity: qty, from, to });
});

registerRoutine('planet_display', (ctx) => {
    echoCommand(ctx, 'planetDisplay');
    ctx.io.sendMsg({ type: ClientTag.PlanetDisplay });
});

registerRoutine('claim_planet', async (ctx) => {
    echoCommand(ctx, 'claimPlanet');
    const ch = await askChar(ctx, render(PLANET.claimOwnershipPrompt), ['p', 'c']);
    if (ch === null) return;
    const ownership = ch === 'p' ? 'personal' : 'clan';
    ctx.io.sendMsg({ type: ClientTag.ClaimPlanet, ownership });
    const result = await awaitResponse(ctx, [ServerTag.ClaimPlanetResult, ServerTag.Error]);
    if (result === null) return;
    if (result.type !== ServerTag.ClaimPlanetResult) return;
    ctx.io.term.writeln(
        render(
            result.ownership === 'clan' ? PLANET.claimSuccessClan : PLANET.claimSuccessPersonal,
            { name: result.planetName },
        ),
    );
});

registerRoutine('destroy_planet', (ctx) => {
    echoCommand(ctx, 'destroyPlanet');
    ctx.io.sendMsg({ type: ClientTag.DestroyPlanet });
});

registerRoutine('leave_planet', (ctx) => {
    echoCommand(ctx, 'leavePlanet');
    ctx.io.sendMsg({ type: ClientTag.LeavePlanet });
});

registerRoutine('planetary_defense_bastion', async (ctx) => {
    echoCommand(ctx, 'planetaryDefenseBastion');
    ctx.io.sendMsg({ type: ClientTag.BaseInfo });
    const reply = await awaitResponse(ctx, [ServerTag.BaseInfoResult, ServerTag.Error]);
    if (reply === null) return;
    if (reply.type !== ServerTag.BaseInfoResult) return;
    const { term } = ctx.io;

    if (reply.mode === 'error') {
        term.writeln('');
        term.writeln(render(PLANET.baseError, { message: reply.message }));
        return;
    }
    if (reply.mode === 'exists') {
        ctx.world.mode = Menu.Base;
        term.writeln('');
        term.writeln(render(PLANET.baseEntered, { level: reply.level }));
        return;
    }
    if (reply.mode === 'constructing') {
        const completes = new Date(reply.completesAt);
        const started = reply.startedAt ? new Date(reply.startedAt) : null;
        const msLeft = completes.getTime() - Date.now();
        const hoursLeft = Math.max(0, Math.ceil(msLeft / (60 * 60 * 1000)));
        term.writeln('');
        term.writeln(
            render(PLANET.baseConstructing, {
                level: reply.targetLevel,
                started: started ? started.toLocaleString() : '?',
                completes: completes.toLocaleString(),
                hours: hoursLeft,
            }),
        );
        return;
    }

    // mode === 'noBase'
    term.writeln('');
    term.writeln(render(PLANET.baseIntro1));
    term.writeln(render(PLANET.baseIntro2));
    term.writeln(render(PLANET.baseIntro3));
    term.writeln(render(PLANET.baseIntro4));
    term.writeln('');
    term.writeln(
        render(PLANET.baseRequirementsHeader, {
            planetClass: reply.planetClass,
            planetType: reply.planetTypeDisplay,
        }),
    );
    const fmtLine = (label: string, need: number, have: number, unit: string) => {
        const short = have < need;
        const status = short ? `[br](short by ${need - have})[/br]` : '[g]ok[/g]';
        return render(PLANET.baseRequirementsLine, {
            label,
            need,
            have,
            unit,
            status,
        });
    };
    term.writeln(fmtLine('Fuel Ore  ', reply.level1.fuel, reply.planetStock.fuel, ''));
    term.writeln(fmtLine('Organics  ', reply.level1.org, reply.planetStock.org, ''));
    term.writeln(fmtLine('Equipment ', reply.level1.equ, reply.planetStock.equ, ''));
    term.writeln(fmtLine('Colonists ', reply.level1.colos, reply.planetStock.colos, ''));
    term.writeln(render(PLANET.baseRequirementsDays, { days: reply.level1.days }));
    term.writeln('');

    const ok = await askConfirm(ctx, render(PLANET.baseConstructPrompt), { defaultValue: false });
    if (!ok) return;
    ctx.io.sendMsg({ type: ClientTag.BuildBase });
    const result = await awaitResponse(ctx, [ServerTag.BuildBaseResult, ServerTag.Error]);
    if (result === null) return;
    if (result.type !== ServerTag.BuildBaseResult) return;
    if (result.outcome === 'started') {
        term.writeln('');
        term.writeln(
            render(PLANET.baseConstructionStarted, {
                level: result.targetLevel,
                days: result.daysRequired,
                completes: new Date(result.completesAt).toLocaleString(),
            }),
        );
    } else {
        term.writeln('');
        term.writeln(render(PLANET.baseError, { message: result.message }));
        if (result.shortfall) {
            const parts: string[] = [];
            if (result.shortfall.fuel) parts.push(`Fuel Ore: ${result.shortfall.fuel}`);
            if (result.shortfall.org) parts.push(`Organics: ${result.shortfall.org}`);
            if (result.shortfall.equ) parts.push(`Equipment: ${result.shortfall.equ}`);
            if (result.shortfall.colos) parts.push(`Colonists: ${result.shortfall.colos}`);
            if (parts.length > 0) {
                term.writeln(render(PLANET.baseShortfall, { items: parts.join(', ') }));
            }
        }
    }
});

registerRoutine('base_computer', (ctx) => {
    echoCommand(ctx, 'baseComputer');
    ctx.world.mode = Menu.BaseComputer;
});

registerRoutine('treasury_transfer', async (ctx) => {
    echoCommand(ctx, 'treasuryTransfer');
    const { term } = ctx.io;

    ctx.io.sendMsg({ type: ClientTag.TreasuryInfo });
    const info = await awaitResponse(ctx, [ServerTag.TreasuryInfoResult, ServerTag.Error]);
    if (info === null) return;
    if (info.type !== ServerTag.TreasuryInfoResult) return;
    if (info.outcome !== 'ok') {
        term.writeln('');
        term.writeln(render(PLANET.treasuryError, { message: info.message }));
        return;
    }

    const dirCh = await askChar(ctx, render(PLANET.treasuryDirectionPrompt), ['t', 'f']);
    if (dirCh === null) return;
    const direction: 'to' | 'from' = dirCh === 't' ? 'to' : 'from';

    term.writeln(
        render(PLANET.treasuryBalances, {
            credits: fmt(info.credits),
            treasury: fmt(info.treasury),
        }),
    );

    const cap = direction === 'to' ? info.credits : info.treasury;
    if (cap <= 0) {
        term.writeln('');
        term.writeln(
            render(PLANET.treasuryError, {
                message:
                    direction === 'to' ? 'No credits on hand to transfer' : 'Treasury is empty',
            }),
        );
        return;
    }

    const amount = await askNumber(ctx, render(PLANET.treasuryAmountPrompt), {
        min: 1,
        max: cap,
    });
    if (amount === null) return;

    ctx.io.sendMsg({ type: ClientTag.TreasuryTransfer, direction, amount });
    const result = await awaitResponse(ctx, [ServerTag.TreasuryTransferResult, ServerTag.Error]);
    if (result === null) return;
    if (result.type !== ServerTag.TreasuryTransferResult) return;
    if (result.outcome !== 'ok') {
        term.writeln('');
        term.writeln(render(PLANET.treasuryError, { message: result.message }));
        return;
    }
    term.writeln(
        render(PLANET.treasuryTransferOk, {
            amount: fmt(result.amount),
            direction: result.direction === 'to' ? 'into' : 'from',
            credits: fmt(result.credits),
            treasury: fmt(result.treasury),
        }),
    );
});

registerRoutine('scan_sector', (ctx) => {
    echoCommand(ctx, 'sectorScan');
    ctx.io.sendMsg({ type: ClientTag.SectorDisplay });
});

registerRoutine('base_transporter', async (ctx) => {
    echoCommand(ctx, 'baseTransporter');
    const { term } = ctx.io;

    ctx.io.sendMsg({ type: ClientTag.BwarpInfo });
    const info = await awaitResponse(ctx, [ServerTag.BwarpInfoResult, ServerTag.Error]);
    if (info === null) return;
    if (info.type !== ServerTag.BwarpInfoResult) return;
    if (info.outcome === 'error') {
        term.writeln('');
        term.writeln(render(PLANET.bwarpError, { message: info.message }));
        return;
    }

    if (info.outcome === 'notInstalled') {
        term.writeln(render(PLANET.bwarpNotInstalledIntro, { cost: fmt(info.installCost) }));
        const ok = await askConfirm(ctx, render(PLANET.bwarpInstallPrompt), {
            defaultValue: false,
        });
        if (!ok) return;
        ctx.io.sendMsg({ type: ClientTag.BwarpInstall });
        const result = await awaitResponse(ctx, [ServerTag.BwarpInstallResult, ServerTag.Error]);
        if (result === null) return;
        if (result.type !== ServerTag.BwarpInstallResult) return;
        if (result.outcome !== 'ok') {
            term.writeln('');
            term.writeln(render(PLANET.bwarpError, { message: result.message }));
            return;
        }
        term.writeln(
            render(PLANET.bwarpInstallFlavor, {
                range: result.range,
                cost: fmt(info.installCost),
            }),
        );
        return;
    }

    // installed
    term.writeln(render(PLANET.bwarpInstalledIntro));
    let currentRange = info.range;
    const upgradeCost = info.upgradeCost;

    // Beam/upgrade loop until the user beams, quits, or hits an error.
    while (true) {
        term.writeln(render(PLANET.bwarpRangeLine, { range: currentRange }));
        const reply = await askLineWithShortcuts(ctx, render(PLANET.bwarpBeamPrompt), ['u']);
        if (reply === null) return;
        if (reply === 'u') {
            term.writeln(render(PLANET.bwarpUpgradePitch, { cost: fmt(upgradeCost) }));
            const ok = await askConfirm(ctx, render(PLANET.bwarpUpgradePrompt), {
                defaultValue: false,
            });
            if (!ok) continue;
            ctx.io.sendMsg({ type: ClientTag.BwarpUpgrade });
            const upgrade = await awaitResponse(ctx, [
                ServerTag.BwarpUpgradeResult,
                ServerTag.Error,
            ]);
            if (upgrade === null) return;
            if (upgrade.type !== ServerTag.BwarpUpgradeResult) return;
            if (upgrade.outcome !== 'ok') {
                term.writeln('');
                term.writeln(render(PLANET.bwarpError, { message: upgrade.message }));
                continue;
            }
            currentRange = upgrade.range;
            term.writeln(
                render(PLANET.bwarpUpgradeFlavor, {
                    cost: fmt(upgrade.cost),
                    treasury: fmt(upgrade.treasury),
                    range: upgrade.range,
                }),
            );
            continue;
        }

        const target = parseInt(reply, 10);
        if (!Number.isFinite(target) || target <= 0) {
            term.writeln('');
            term.writeln(render(PLANET.bwarpError, { message: 'Enter a sector number.' }));
            continue;
        }

        ctx.io.sendMsg({ type: ClientTag.BwarpBeam, targetSector: target, commit: false });
        const distance = await awaitResponse(ctx, [ServerTag.BwarpBeamResult, ServerTag.Error]);
        if (distance === null) return;
        if (distance.type !== ServerTag.BwarpBeamResult) return;
        if (distance.outcome === 'error') {
            term.writeln('');
            term.writeln(render(PLANET.bwarpError, { message: distance.message }));
            continue;
        }
        if (distance.outcome !== 'distance') return;

        term.writeln(
            render(PLANET.bwarpDistanceLine, {
                sector: distance.targetSector,
                hops: distance.hops,
            }),
        );
        if (distance.hops > distance.range) {
            term.writeln(
                render(PLANET.bwarpOutOfRange, {
                    range: distance.range,
                    hops: distance.hops,
                }),
            );
            continue;
        }
        term.writeln(
            render(PLANET.bwarpFuelCheck, {
                fuelCost: fmt(distance.fuelCost),
                planetFuel: fmt(distance.planetFuel),
            }),
        );
        if (distance.fuelCost > distance.planetFuel) {
            term.writeln(render(PLANET.bwarpInsufficientFuel));
            continue;
        }

        const engage = await askConfirm(ctx, render(PLANET.bwarpEngagePrompt), {
            defaultValue: true,
        });
        if (!engage) continue;

        ctx.io.sendMsg({ type: ClientTag.BwarpBeam, targetSector: target, commit: true });
        const beam = await awaitResponse(ctx, [ServerTag.BwarpBeamResult, ServerTag.Error]);
        if (beam === null) return;
        if (beam.type !== ServerTag.BwarpBeamResult) return;
        if (beam.outcome !== 'beamed') {
            term.writeln('');
            term.writeln(
                render(PLANET.bwarpError, {
                    message: beam.outcome === 'error' ? beam.message : 'Beam aborted.',
                }),
            );
            continue;
        }
        term.writeln(
            render(PLANET.bwarpBeamedFlavor, {
                sector: beam.targetSector,
                hops: beam.hops,
                fuelUsed: fmt(beam.fuelUsed),
            }),
        );
        // Transition out of the base/planet: we're now in the destination sector.
        ctx.world.mode = Menu.Sector;
        ctx.world.currentSector = beam.targetSector;
        ctx.io.sendMsg({ type: ClientTag.SectorDisplay });
        return;
    }
});

registerRoutine('exit_base', (ctx) => {
    echoCommand(ctx, 'exitBase');
    ctx.io.sendMsg({ type: ClientTag.ExitBase });
    ctx.world.mode = Menu.Planet;
});
