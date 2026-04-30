import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { SECTOR } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { registerMenu } from './types.js';

registerMenu(Menu.JettisonConfirm, {
    renderPrompt(ctx) {
        ctx.io.term.write(render(SECTOR.jettisonConfirm));
    },
    input(ctx, line) {
        switch (line.toLowerCase()) {
            case 'y':
                ctx.io.sendMsg({ type: ClientMsgType.Jettison });
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
                break;
            case '':
            case 'n':
                echoCommand(ctx, 'jettisonConfirmBack');
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
                break;
        }
    },
});
