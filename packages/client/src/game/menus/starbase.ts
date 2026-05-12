import { ClientTag, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { showStarbaseMenu } from '../display-starbase.js';
import { registerMenu, registerRoutine } from './types.js';

registerMenu(Menu.Starbase, {
    renderPrompt: showStarbaseMenu,
});

registerRoutine('shipyards_menu', (ctx) => {
    echoCommand(ctx, 'shipyards');
    ctx.world.mode = Menu.Shipyards;
});

registerRoutine('hardware_store', (ctx) => {
    echoCommand(ctx, 'hardwareStoreInfo');
    ctx.io.sendMsg({ type: ClientTag.HardwareStoreInfo });
});
