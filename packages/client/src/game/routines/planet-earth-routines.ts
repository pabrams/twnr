import { Menu, Commands, command } from '@twnr/shared';
import { render } from '../renderer.js';
import { PLANET } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { showEarthMenu } from '../display-planet.js';
import { registerRoutine, registerMenuRoutine } from './types.js';
import { askNumber } from './prompts.js';

registerRoutine('takeFromEarth', async (ctx) => {
    echoCommand(ctx, 'takeColonists');
    const qty = await askNumber(
        ctx,
        render(PLANET.takePrompt, { emptyHolds: ctx.ship.planetEmptyHolds }),
        { defaultValue: -1 },
    );
    if (qty === null || qty === 0) return;
    ctx.io.sendMsg(command(Commands.TakeColonists, { quantity: qty, commodity: 'fuel' }));
});

registerRoutine('leaveOnEarth', async (ctx) => {
    echoCommand(ctx, 'leaveColonists');
    const qty = await askNumber(
        ctx,
        render(PLANET.leavePrompt, { shipColonists: ctx.ship.shipColonists }),
        { defaultValue: -1 },
    );
    if (qty === null || qty === 0) return;
    ctx.io.sendMsg(command(Commands.LeaveColonists, { quantity: qty, commodity: 'fuel' }));
});

registerMenuRoutine(Menu.PlanetEarth, 'helpMenu', (ctx) => {
    showEarthMenu(ctx, ctx.world.earthColonists);
});
