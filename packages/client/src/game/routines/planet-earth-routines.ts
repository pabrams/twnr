import { ClientTag, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { PLANET } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { showEarthMenu } from '../display-planet.js';
import { registerRoutine, registerMenuRoutine } from './types.js';
import { askNumber } from './prompts.js';

registerRoutine('take_from_earth', async (ctx) => {
    echoCommand(ctx, 'takeColonists');
    const qty = await askNumber(
        ctx,
        render(PLANET.takePrompt, { emptyHolds: ctx.ship.planetEmptyHolds }),
        { defaultValue: -1 },
    );
    if (qty === null) return;
    ctx.io.sendMsg({ type: ClientTag.TakeColonists, quantity: qty, commodity: 'fuel' });
});

registerRoutine('leave_on_earth', async (ctx) => {
    echoCommand(ctx, 'leaveColonists');
    const qty = await askNumber(
        ctx,
        render(PLANET.leavePrompt, { shipColonists: ctx.ship.shipColonists }),
        { defaultValue: -1 },
    );
    if (qty === null) return;
    ctx.io.sendMsg({ type: ClientTag.LeaveColonists, quantity: qty, commodity: 'fuel' });
});

// Earth's `?` is a fancier visual than the generic help_menu listing.
registerMenuRoutine(Menu.PlanetEarth, 'help_menu', (ctx) => {
    showEarthMenu(ctx, ctx.world.earthColonists);
});
