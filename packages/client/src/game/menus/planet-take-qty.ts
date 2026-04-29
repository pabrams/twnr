import { ClientMsgType, Menu } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { showPlanetTakePrompt } from '../display-planet.js';
import { echoCommand } from '../display.js';
import { registerMenu } from './types.js';

function backToPlanetMenu(ctx: GameContext): void {
    echoCommand(ctx, 'planetTakeQtyBack');
    const target = ctx.currentSector === 1 ? Menu.PlanetEarth : Menu.Planet;
    ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: target });
}

registerMenu(Menu.PlanetTakeQty, {
    enter: showPlanetTakePrompt,
    input(ctx, line) {
        const trimmed = line.trim();
        if (trimmed.toLowerCase() === 'q') {
            backToPlanetMenu(ctx);
            return;
        }
        // Empty Enter → accept default (fill free holds; server computes).
        const qty = trimmed === '' ? -1 : parseInt(trimmed, 10);
        if (qty === 0) {
            // 0 colonists = nothing to do; cancel back to the planet menu.
            backToPlanetMenu(ctx);
            return;
        }
        if (qty !== -1 && (isNaN(qty) || qty < 0)) {
            ctx.term.writeln('Enter a positive number.');
            return;
        }
        // qty submission for an in-progress take-colonists flow — the echo
        // already fired when the user pressed T at the planet menu.
        ctx.sendMsg({
            type: ClientMsgType.TakeColonists,
            quantity: qty,
            commodity: ctx.colonistCommodity ?? 'fuel',
        });
    },
});
