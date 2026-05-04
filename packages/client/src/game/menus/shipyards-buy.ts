import { ClientMsgType, Menu, type ShipCatalogEntry } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import {
    showShipBuyList,
    showShipyardsBuyPrompt,
    showTradeinInfo,
    letterToIndex,
} from '../display-starbase.js';
import { NOTIFY, COMMON, STARBASE } from '../messages/index.js';
import { registerMenu, registerMenuRoutine } from './types.js';
import { askConfirm } from './prompts.js';

function calculateShipPrice(ship: ShipCatalogEntry): number {
    return (
        (ship.cost_drive ?? 0) +
        (ship.cost_computer ?? 0) +
        (ship.cost_hull ?? 0) +
        (ship.starting_holds ?? 0) * (ship.hold_cost ?? 0)
    );
}

function getCurrentShipPrice(ctx: GameContext): number {
    if (!ctx.catalogs.ships || !ctx.ship.currentShipName) return 0;
    const ship = ctx.catalogs.ships.find((s) => s.name === ctx.ship.currentShipName);
    return ship ? calculateShipPrice(ship) : 0;
}

registerMenu(Menu.ShipyardsBuy, {
    renderPrompt(ctx) {
        void showShipBuyList(ctx);
        showShipyardsBuyPrompt(ctx);
    },
});

// Picks a ship by letter, displays the tradein info, then asks Y/N/Q
// inline. The shipyardsTradein menu is gone — the confirm is a
// sub-prompt of this routine, not a separate menu.
registerMenuRoutine(Menu.ShipyardsBuy, 'view_detail', async (ctx, line) => {
    const idx = letterToIndex(line);
    if (!ctx.catalogs.ships || idx < 0 || idx >= ctx.catalogs.ships.length) {
        ctx.io.term.writeln(render(NOTIFY.invalidSelection));
        showShipyardsBuyPrompt(ctx);
        return;
    }
    const ship = ctx.catalogs.ships[idx];
    if (ship.name === ctx.ship.currentShipName) {
        ctx.io.term.writeln(render(COMMON.errorLine, { text: 'Already flying that ship.' }));
        showShipyardsBuyPrompt(ctx);
        return;
    }
    const price = calculateShipPrice(ship);
    const tradein = getCurrentShipPrice(ctx);
    showTradeinInfo(ctx, ship.display_name ?? ship.name, price, tradein);
    const yes = await askConfirm(ctx, render(STARBASE.tradeinConfirm));
    if (yes === null) return;
    if (yes) {
        ctx.io.sendMsg({ type: ClientMsgType.BuyShipTradein, targetShipName: ship.name });
    } else {
        ctx.io.sendMsg({ type: ClientMsgType.BuyShipNew, targetShipName: ship.name });
    }
});
