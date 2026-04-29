import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { NOTIFY } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { registerMenu } from './types.js';

registerMenu(Menu.TerraformConfirm, {
    enter(ctx) {
        ctx.term.write(render(NOTIFY.terraformConfirm));
    },
    input(ctx, line) {
        const t = line.trim().toLowerCase();
        switch (t) {
            case 'y':
                echoCommand(ctx, 'useTerraformDevice');
                ctx.sendMsg({ type: ClientMsgType.UseTerraformDevice });
                return;
            case '':
            case 'n':
                ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
                return;
            default:
                ctx.term.write(render(NOTIFY.terraformConfirm));
        }
    },
});
