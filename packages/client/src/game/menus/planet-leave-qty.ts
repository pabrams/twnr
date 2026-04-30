import { ClientMsgType, Menu } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { showPlanetLeavePrompt } from '../display-planet.js';
import { echoCommand } from '../display.js';
import { registerMenu, getMenuArgs } from './types.js';

function backToPlanetMenu(ctx: GameContext): void {
    echoCommand(ctx, 'planetLeaveQtyBack');
    const target = ctx.world.currentSector === 1 ? Menu.PlanetEarth : Menu.Planet;
    ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: target });
}

registerMenu(Menu.PlanetLeaveQty, {
    renderPrompt: showPlanetLeavePrompt,
    input(ctx, line) {
        const trimmed = line.trim();
        if (trimmed.toLowerCase() === 'q') {
            backToPlanetMenu(ctx);
            return;
        }
        const qty = trimmed === '' ? -1 : parseInt(trimmed, 10);
        if (qty === 0) {
            backToPlanetMenu(ctx);
            return;
        }
        if (qty !== -1 && (isNaN(qty) || qty < 0)) {
            ctx.io.term.writeln('Enter a positive number.');
            return;
        }
        ctx.io.sendMsg({
            type: ClientMsgType.LeaveColonists,
            quantity: qty,
            commodity: getMenuArgs(ctx, Menu.PlanetLeaveQty)?.commodity ?? 'fuel',
        });
    },
});
