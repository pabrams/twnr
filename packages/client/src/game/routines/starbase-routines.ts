import { ClientTag, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { registerRoutine } from './types.js';

registerRoutine('shipyards_menu', (ctx) => {
    echoCommand(ctx, 'shipyards');
    ctx.world.mode = Menu.Shipyards;
});

registerRoutine('hardware_store', (ctx) => {
    echoCommand(ctx, 'hardwareStoreInfo');
    ctx.io.sendMsg({ type: ClientTag.HardwareStoreInfo });
});
