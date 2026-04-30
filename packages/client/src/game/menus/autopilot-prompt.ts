import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { NOTIFY, EVENT } from '../messages/index.js';
import { registerMenu } from './types.js';

registerMenu(Menu.AutopilotPrompt, {
    input(ctx, line) {
        switch (line.trim().toLowerCase()) {
            case '':
            case 'y': {
                ctx.io.term.writeln(render(NOTIFY.autopilotEngaged));
                const nextSector = ctx.autopilot.path[1];
                ctx.autopilot.step = 2;
                ctx.io.term.writeln(render(EVENT.autopilotWarping, { sector: nextSector }));
                ctx.io.sendMsg({ type: ClientMsgType.Move, sector: nextSector });
                break;
            }
            case 'n':
                ctx.autopilot.path = [];
                ctx.autopilot.step = 0;
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
                break;
        }
    },
});
