import { ClientMsgType, Menu, type ShipCatalogEntry } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { showShipBuyList, showShipyardsBuyPrompt, letterToIndex } from '../display-starbase.js';
import { NOTIFY, COMMON } from '../messages/index.js';
import { registerMenu, registerMenuRoutine, setMenuArgs } from './types.js';

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

registerMenuRoutine(Menu.ShipyardsBuy, 'view_detail', (ctx, line) => {
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
    setMenuArgs(ctx, {
        menu: Menu.ShipyardsTradein,
        target: ship.name,
        displayName: ship.display_name ?? ship.name,
        price: calculateShipPrice(ship),
        tradein: getCurrentShipPrice(ctx),
    });
    ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipyardsTradein });
});
