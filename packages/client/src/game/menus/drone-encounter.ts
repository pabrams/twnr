import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { showDroneEncounterPrompt } from '../display-combat.js';
import { registerMenu } from './types.js';

registerMenu(Menu.DroneEncounter, {
    renderPrompt: showDroneEncounterPrompt,
    input(ctx, line) {
        switch (line.toLowerCase()) {
            case 'a':
                echoCommand(ctx, 'attackSectorDrones');
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.DroneAttackQty });
                break;
            case 'r':
                echoCommand(ctx, 'retreatFromDrones');
                ctx.io.sendMsg({ type: ClientMsgType.RetreatFromDrones });
                break;
        }
    },
});
