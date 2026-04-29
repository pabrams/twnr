import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { NOTIFY } from '../messages/index.js';
import { registerMenu } from './types.js';

registerMenu(Menu.QuitConfirm, {
    enter(ctx) {
        ctx.term.write(render(NOTIFY.quitConfirm));
    },
    input(ctx, line) {
        const t = line.trim().toLowerCase();
        switch (t) {
            case 'y':
                ctx.term.writeln(render(NOTIFY.goodbye));
                ctx.ws.close();
                return;
            case '':
            case 'n':
                ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
                return;
            default:
                ctx.term.write(render(NOTIFY.quitConfirm));
        }
    },
});
