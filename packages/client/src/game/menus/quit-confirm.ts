import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { NOTIFY } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { registerMenu } from './types.js';

registerMenu(Menu.QuitConfirm, {
    renderPrompt(ctx) {
        ctx.io.term.write(render(NOTIFY.quitConfirm));
    },
    input(ctx, line) {
        const t = line.trim().toLowerCase();
        switch (t) {
            case 'y':
                ctx.io.term.writeln(render(NOTIFY.goodbye));
                ctx.io.ws.close();
                return;
            case '':
            case 'n':
                echoCommand(ctx, 'quitConfirmBack');
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
                return;
        }
    },
});
