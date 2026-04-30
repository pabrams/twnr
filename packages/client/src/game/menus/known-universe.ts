import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import {
    showKnownUniverseMenu,
    showExploredSectors,
    showUnexploredSectors,
} from '../display-computer.js';
import { registerMenu } from './types.js';

registerMenu(Menu.KnownUniverse, {
    renderPrompt: showKnownUniverseMenu,
    input(ctx, line) {
        switch (line.toLowerCase()) {
            case 'e':
                showExploredSectors(ctx);
                break;
            case 'u':
                showUnexploredSectors(ctx);
                break;
            case 'q':
                echoCommand(ctx, 'knownUniverseBack');
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Computer });
                break;
        }
    },
});
