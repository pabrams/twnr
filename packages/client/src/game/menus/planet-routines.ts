import { ClientMsgType, ServerMsgType } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { PLANET } from '../messages/index.js';
import { echoCommand } from '../display.js';
import {
    showPlanetTakeCommodityMenu,
    showPlanetLeaveCommodityMenu,
    showPlanetTakeStockpileMenu,
    showPlanetLeaveStockpileMenu,
} from '../display-planet.js';
import { registerRoutine } from './types.js';
import { askChar, askNumber, awaitResponse } from './prompts.js';

type Commodity4 = 'fuel' | 'organics' | 'equipment' | 'drones';
const COMMODITY_MAP: Record<string, Commodity4> = {
    f: 'fuel',
    o: 'organics',
    e: 'equipment',
    d: 'drones',
};

async function pickCommodity(ctx: GameContext): Promise<Commodity4 | null> {
    const ch = await askChar(ctx, render(PLANET.commodityPrompt), ['f', 'o', 'e', 'd']);
    return ch ? (COMMODITY_MAP[ch] ?? null) : null;
}

registerRoutine('take_colonists', async (ctx) => {
    echoCommand(ctx, 'takeColonists');
    showPlanetTakeCommodityMenu(ctx);
    const commodity = await pickCommodity(ctx);
    if (!commodity) return;
    const qty = await askNumber(
        ctx,
        render(PLANET.takePrompt, { emptyHolds: ctx.ship.planetEmptyHolds }),
        { defaultValue: -1 },
    );
    if (qty === null) return;
    ctx.io.sendMsg({ type: ClientMsgType.TakeColonists, quantity: qty, commodity });
});

registerRoutine('leave_colonists', async (ctx) => {
    echoCommand(ctx, 'leaveColonists');
    showPlanetLeaveCommodityMenu(ctx);
    const commodity = await pickCommodity(ctx);
    if (!commodity) return;
    const qty = await askNumber(
        ctx,
        render(PLANET.leavePrompt, { shipColonists: ctx.ship.shipColonists }),
        { defaultValue: -1 },
    );
    if (qty === null) return;
    ctx.io.sendMsg({ type: ClientMsgType.LeaveColonists, quantity: qty, commodity });
});

function takeDefault(ctx: GameContext, commodity: Commodity4): number {
    const planet =
        commodity === 'fuel'
            ? ctx.planet.fuel
            : commodity === 'organics'
              ? ctx.planet.organics
              : commodity === 'equipment'
                ? ctx.planet.equipment
                : ctx.planet.drones;
    const shipRoom =
        commodity === 'drones'
            ? Math.max(0, ctx.ship.shipMaxDrones - ctx.ship.shipDrones)
            : ctx.ship.planetEmptyHolds;
    return Math.max(0, Math.min(planet, shipRoom));
}

function leaveDefault(ctx: GameContext, commodity: Commodity4): number {
    const onShip =
        commodity === 'fuel'
            ? ctx.ship.shipFuel
            : commodity === 'organics'
              ? ctx.ship.shipOrganics
              : commodity === 'equipment'
                ? ctx.ship.shipEquipment
                : ctx.ship.shipDrones;
    const planetRoom =
        commodity === 'fuel'
            ? Math.max(0, ctx.planet.maxFuel - ctx.planet.fuel)
            : commodity === 'organics'
              ? Math.max(0, ctx.planet.maxOrg - ctx.planet.organics)
              : commodity === 'equipment'
                ? Math.max(0, ctx.planet.maxEqu - ctx.planet.equipment)
                : Math.max(0, ctx.planet.maxDrones - ctx.planet.drones);
    return Math.max(0, Math.min(onShip, planetRoom));
}

registerRoutine('take_commodity', async (ctx) => {
    echoCommand(ctx, 'takeCommodity');
    showPlanetTakeStockpileMenu(ctx);
    const commodity = await pickCommodity(ctx);
    if (!commodity) return;
    const def = takeDefault(ctx, commodity);
    const qty = await askNumber(
        ctx,
        render(PLANET.takeStockpileQtyPrompt, { commodity, default: def }),
        { defaultValue: def },
    );
    if (qty === null) return;
    ctx.io.sendMsg({ type: ClientMsgType.TakeCommodity, quantity: qty, commodity });
});

registerRoutine('leave_commodity', async (ctx) => {
    echoCommand(ctx, 'leaveCommodity');
    showPlanetLeaveStockpileMenu(ctx);
    const commodity = await pickCommodity(ctx);
    if (!commodity) return;
    const def = leaveDefault(ctx, commodity);
    const qty = await askNumber(
        ctx,
        render(PLANET.leaveStockpileQtyPrompt, { commodity, default: def }),
        { defaultValue: def },
    );
    if (qty === null) return;
    ctx.io.sendMsg({ type: ClientMsgType.LeaveCommodity, quantity: qty, commodity });
});

registerRoutine('planet_display', (ctx) => {
    echoCommand(ctx, 'planetDisplay');
    ctx.io.sendMsg({ type: ClientMsgType.PlanetDisplay });
});

registerRoutine('claim_planet', async (ctx) => {
    echoCommand(ctx, 'claimPlanet');
    const ch = await askChar(ctx, render(PLANET.claimOwnershipPrompt), ['p', 'c']);
    if (ch === null) return;
    const ownership = ch === 'p' ? 'personal' : 'clan';
    ctx.io.sendMsg({ type: ClientMsgType.ClaimPlanet, ownership });
    const result = await awaitResponse(ctx, [ServerMsgType.ClaimPlanetResult, ServerMsgType.Error]);
    if (result === null) return;
    if (result.type !== ServerMsgType.ClaimPlanetResult) return;
    ctx.io.term.writeln(
        render(
            result.ownership === 'clan' ? PLANET.claimSuccessClan : PLANET.claimSuccessPersonal,
            { name: result.planetName },
        ),
    );
});

registerRoutine('destroy_planet', (ctx) => {
    echoCommand(ctx, 'destroyPlanet');
    ctx.io.sendMsg({ type: ClientMsgType.DestroyPlanet });
});

registerRoutine('leave_planet', (ctx) => {
    echoCommand(ctx, 'leavePlanet');
    ctx.io.sendMsg({ type: ClientMsgType.LeavePlanet });
});
