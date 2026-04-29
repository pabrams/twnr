import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { NOTIFY, EVENT } from '../messages/index.js';
import { registerMenu } from './types.js';

// AutopilotPrompt has no `enter`: its prompt is rendered by the
// ShortestPathResult handler in connection.ts via showAutopilotPrompt.
registerMenu(Menu.AutopilotPrompt, {
    input(ctx, line) {
        switch (line.trim().toLowerCase()) {
            case '':
            case 'y': {
                ctx.term.writeln(render(NOTIFY.autopilotEngaged));
                const nextSector = ctx.autopilotPath[1];
                ctx.autopilotStep = 2;
                ctx.term.writeln(render(EVENT.autopilotWarping, { sector: nextSector }));
                ctx.sendMsg({ type: ClientMsgType.Move, sector: nextSector });
                break;
            }
            case 'n':
                ctx.autopilotPath = [];
                ctx.autopilotStep = 0;
                ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
                break;
        }
    },
});
