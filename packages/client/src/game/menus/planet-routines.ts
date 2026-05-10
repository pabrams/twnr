import { ClientMsgType } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { PLANET } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { showPlanetTakeCommodityMenu, showPlanetLeaveCommodityMenu } from '../display-planet.js';
import { registerRoutine } from './types.js';
import { askChar, askNumber } from './prompts.js';

const COMMODITY_MAP: Record<string, 'fuel' | 'organics' | 'equipment'> = {
    f: 'fuel',
    o: 'organics',
    e: 'equipment',
};

async function pickCommodity(ctx: GameContext): Promise<'fuel' | 'organics' | 'equipment' | null> {
    const ch = await askChar(ctx, render(PLANET.commodityPrompt), ['f', 'o', 'e']);
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

registerRoutine('planet_display', (ctx) => {
    echoCommand(ctx, 'planetDisplay');
    ctx.io.sendMsg({ type: ClientMsgType.PlanetDisplay });
});

registerRoutine('destroy_planet', (ctx) => {
    echoCommand(ctx, 'destroyPlanet');
    ctx.io.sendMsg({ type: ClientMsgType.DestroyPlanet });
});

registerRoutine('leave_planet', (ctx) => {
    echoCommand(ctx, 'leavePlanet');
    ctx.io.sendMsg({ type: ClientMsgType.LeavePlanet });
});
