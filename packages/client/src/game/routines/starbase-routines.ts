import { Menu, Commands, command } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { registerRoutine } from './types.js';

registerRoutine('shipyardsMenu', (ctx) => {
    echoCommand(ctx, 'shipyards');
    ctx.world.mode = Menu.Shipyards;
});

registerRoutine('hardwareStore', (ctx) => {
    echoCommand(ctx, 'hardwareStoreInfo');
    ctx.io.sendMsg(command(Commands.HardwareStoreInfo, {}));
});
