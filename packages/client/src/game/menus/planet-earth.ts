import { ClientMsgType, Menu } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { PLANET } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { showEarthMenu, showEarthPrompt } from '../display-planet.js';
import { registerMenu } from './types.js';
import { askNumber } from './prompts.js';

/**
 * Earth menu — client-driven (like the hardware store). Earth is special:
 * it's the only "planet" that the player should NOT remain at across
 * disconnects (server resets currentMenu to 'sector' on reconnect), and
 * both Take and Leave colonists auto-lift the ship after the action.
 *
 * Earth has only one commodity (fuel-colonists), so T and L skip the
 * commodity-pick step that the regular planet menu does and go straight
 * to qty (askNumber inline). No PlanetTakeQty/PlanetLeaveQty transitions.
 *
 * No `menu_command` rows for `planetEarth` in the DB; `acceptsKey`
 * filters out everything but T/L/Q/?.
 */
const EARTH_KEYS = new Set(['t', 'l', 'q', '?']);

async function takeFromEarth(ctx: GameContext): Promise<void> {
    echoCommand(ctx, 'takeColonists');
    const qty = await askNumber(
        ctx,
        render(PLANET.takePrompt, { emptyHolds: ctx.ship.planetEmptyHolds }),
        // -1 = "default" (server takes max colonists clamped by free holds).
        { defaultValue: -1 },
    );
    if (qty === null) return;
    ctx.io.sendMsg({ type: ClientMsgType.TakeColonists, quantity: qty, commodity: 'fuel' });
}

async function leaveOnEarth(ctx: GameContext): Promise<void> {
    echoCommand(ctx, 'leaveColonists');
    const qty = await askNumber(
        ctx,
        render(PLANET.leavePrompt, { shipColonists: ctx.ship.shipColonists }),
        // -1 = "default" (server leaves all colonists from the ship).
        { defaultValue: -1 },
    );
    if (qty === null) return;
    ctx.io.sendMsg({ type: ClientMsgType.LeaveColonists, quantity: qty, commodity: 'fuel' });
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
            ctx.io.sendMsg({ type: ClientMsgType.LeavePlanet });
            return;
        }
    },
});
