import { ClientTag, Menu } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { PLANET } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { showEarthMenu, showEarthPrompt } from '../display-planet.js';
import { registerMenu } from './types.js';
import { askNumber } from './prompts.js';

const EARTH_KEYS = new Set(['t', 'l', 'q', '?']);

async function takeFromEarth(ctx: GameContext): Promise<void> {
    echoCommand(ctx, 'takeColonists');
    const qty = await askNumber(
        ctx,
        render(PLANET.takePrompt, { emptyHolds: ctx.ship.planetEmptyHolds }),
        { defaultValue: -1 },
    );
    if (qty === null) return;
    ctx.io.sendMsg({ type: ClientTag.TakeColonists, quantity: qty, commodity: 'fuel' });
}

async function leaveOnEarth(ctx: GameContext): Promise<void> {
    echoCommand(ctx, 'leaveColonists');
    const qty = await askNumber(
        ctx,
        render(PLANET.leavePrompt, { shipColonists: ctx.ship.shipColonists }),
        { defaultValue: -1 },
    );
    if (qty === null) return;
    ctx.io.sendMsg({ type: ClientTag.LeaveColonists, quantity: qty, commodity: 'fuel' });
}

registerMenu(Menu.PlanetEarth, {
    renderPrompt: showEarthPrompt,
    acceptsKey: (k) => EARTH_KEYS.has(k.toLowerCase()),
    input(ctx, line) {
        const k = line.toLowerCase();
        if (k === '?') {
            showEarthMenu(ctx, ctx.world.earthColonists);
            return;
        }
        if (k === 't') {
            void takeFromEarth(ctx);
            return;
        }
        if (k === 'l') {
            void leaveOnEarth(ctx);
            return;
        }
        if (k === 'q') {
            echoCommand(ctx, 'leavePlanet');
            ctx.io.sendMsg({ type: ClientTag.LeavePlanet });
            return;
        }
    },
});
