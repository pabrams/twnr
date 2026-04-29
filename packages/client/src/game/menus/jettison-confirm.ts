import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { SECTOR } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { registerMenu } from './types.js';

registerMenu(Menu.JettisonConfirm, {
    enter(ctx) {
        ctx.term.write(render(SECTOR.jettisonConfirm));
    },
    input(ctx, line) {
        switch (line.toLowerCase()) {
            case 'y':
                // Confirmation step — the <Jettison> echo fired when the
                // user pressed J at the sector menu.
                ctx.sendMsg({ type: ClientMsgType.Jettison });
                ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
                break;
            case '':
            case 'n':
                echoCommand(ctx, 'jettisonConfirmBack');
                ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
                break;
        }
    },
});
