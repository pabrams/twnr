import { ClientMsgType, Menu } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { showPlanetLeavePrompt } from '../display-planet.js';
import { echoCommand } from '../display.js';
import { registerMenu } from './types.js';

function backToPlanetMenu(ctx: GameContext): void {
    echoCommand(ctx, 'planetLeaveQtyBack');
    const target = ctx.currentSector === 1 ? Menu.PlanetEarth : Menu.Planet;
    ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: target });
}

registerMenu(Menu.PlanetLeaveQty, {
    enter: showPlanetLeavePrompt,
    input(ctx, line) {
        const trimmed = line.trim();
        if (trimmed.toLowerCase() === 'q') {
            backToPlanetMenu(ctx);
            return;
        }
        // Empty Enter → accept default (leave all ship colonists; server
        // computes).
        const qty = trimmed === '' ? -1 : parseInt(trimmed, 10);
        if (qty === 0) {
            backToPlanetMenu(ctx);
            return;
        }
        if (qty !== -1 && (isNaN(qty) || qty < 0)) {
            ctx.term.writeln('Enter a positive number.');
            return;
        }
        // qty submission for an in-progress leave-colonists flow — the echo
        // already fired when the user pressed L at the planet menu.
        ctx.sendMsg({
            type: ClientMsgType.LeaveColonists,
            quantity: qty,
            commodity: ctx.colonistCommodity ?? 'fuel',
        });
    },
});
