import { ClientMsgType, Menu, type ShipCatalogEntry } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { echoCommand } from '../display.js';
import { showShipBuyList, letterToIndex } from '../display-starbase.js';
import { NOTIFY, COMMON } from '../messages/index.js';
import { registerMenu } from './types.js';

function calculateShipPrice(ship: ShipCatalogEntry): number {
    return (
        (ship.cost_drive ?? 0) +
        (ship.cost_computer ?? 0) +
        (ship.cost_hull ?? 0) +
        (ship.starting_holds ?? 0) * (ship.hold_cost ?? 0)
    );
}

function getCurrentShipPrice(ctx: GameContext): number {
    if (!ctx.shipConfigs || !ctx.currentShipName) return 0;
    const ship = ctx.shipConfigs.find((s) => s.name === ctx.currentShipName);
    return ship ? calculateShipPrice(ship) : 0;
}

registerMenu(Menu.ShipyardsBuy, {
    enter(ctx) {
        showShipBuyList(ctx);
    },
    input(ctx, line) {
        if (line.toLowerCase() === 'q') {
            echoCommand(ctx, 'shipyards');
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Shipyards });
            return;
        }
        const idx = letterToIndex(line);
        if (ctx.shipConfigs && idx >= 0 && idx < ctx.shipConfigs.length) {
            const ship = ctx.shipConfigs[idx];
            if (ship.name === ctx.currentShipName) {
                ctx.term.writeln(render(COMMON.errorLine, { text: 'Already flying that ship.' }));
                return;
            }
            ctx.shipyardsBuyTarget = ship.name;
            ctx.shipyardsBuyDisplayName = ship.display_name ?? ship.name;
            ctx.shipyardsBuyPrice = calculateShipPrice(ship);
            ctx.shipyardsBuyTradein = getCurrentShipPrice(ctx);
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipyardsTradein });
        } else {
            ctx.term.writeln(render(NOTIFY.invalidSelection));
        }
    },
});
