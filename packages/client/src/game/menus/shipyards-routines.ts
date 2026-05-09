import { ClientMsgType, Menu, type ShipCatalogEntry } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { echoCommand } from '../display.js';
import {
    indexToLetter,
    letterToIndex,
    showShipBuyList,
    showShipExamineList,
    showTradeinInfo,
} from '../display-starbase.js';
import { showShipDetail } from '../display-computer.js';
import { class0QtyPreamble } from '../display-port.js';
import { COMMON, COMPUTER, NOTIFY, STARBASE } from '../messages/index.js';
import { registerRoutine } from './types.js';
import { askChar, askConfirm, askNumber } from './prompts.js';

/**
 * Routines for the shipyards menu and its class-0 buy submenu (which is
 * also reused as the in-port class-0 trade menu). Pure router behavior:
 * each key transitions to a child menu or sends a parameterless message.
 * `back` and `help_menu` come from common-routines.ts.
 *
 * The class0/shipyardsClass0 a/b/c routines stash a `kind` arg so the
 * downstream qty menu knows which commodity the user is buying. When the
 * qty-prompt collapse lands, those will move into a single askNumber
 * call inside this routine.
 */

// Buy / examine: pure client-side viewers backed by the cached ship catalog.
// The dedicated server-side menus (Menu.ShipyardsBuy, Menu.ShipyardsExamine)
// were retired — we stay in Menu.Shipyards while looping locally. The buy
// flow's only server roundtrip is the final BuyShip{Tradein,New}; the server
// stamps menu='shipyards' on the result so the auto-render repaints us.
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

registerRoutine('buy_ship', async (ctx) => {
    echoCommand(ctx, 'shipyardsBuy');
    await showShipBuyList(ctx);
    const ships = ctx.catalogs.ships;
    if (!ships || ships.length === 0) return;
    const letters = ships.map((_, i) => indexToLetter(i).toLowerCase());
    const allowed = [...letters, '?'];
    while (true) {
        const ch = await askChar(ctx, render(STARBASE.shipyardsBuyPrompt), allowed);
        if (ch === null) return;
        if (ch === '?') {
            await showShipBuyList(ctx);
            continue;
        }
        const idx = letterToIndex(ch);
        if (idx < 0 || idx >= ships.length) {
            ctx.io.term.writeln(render(NOTIFY.invalidSelection));
            continue;
        }
        const ship = ships[idx];
        if (ship.name === ctx.ship.currentShipName) {
            ctx.io.term.writeln(render(COMMON.errorLine, { text: 'Already flying that ship.' }));
            continue;
        }
        const price = calculateShipPrice(ship);
        const tradein = getCurrentShipPrice(ctx);
        showTradeinInfo(ctx, ship.display_name ?? ship.name, price, tradein);
        const yes = await askConfirm(ctx, render(STARBASE.tradeinConfirm));
        if (yes === null) continue;
        if (yes) {
            ctx.io.sendMsg({ type: ClientMsgType.BuyShipTradein, targetShipName: ship.name });
        } else {
            ctx.io.sendMsg({ type: ClientMsgType.BuyShipNew, targetShipName: ship.name });
        }
        return;
    }
});

registerRoutine('examine_ships', async (ctx) => {
    echoCommand(ctx, 'shipyardsExamine');
    await showShipExamineList(ctx);
    const ships = ctx.catalogs.ships;
    if (!ships || ships.length === 0) return;
    const letters = ships.map((_, i) => indexToLetter(i).toLowerCase());
    const allowed = [...letters, '?'];
    while (true) {
        const ch = await askChar(ctx, render(COMPUTER.shipInterestPrompt), allowed);
        if (ch === null) return;
        if (ch === '?') {
            await showShipExamineList(ctx);
            continue;
        }
        const idx = letterToIndex(ch);
        if (idx >= 0 && idx < ships.length) {
            showShipDetail(ctx, ships[idx]);
        } else {
            ctx.io.term.writeln(render(NOTIFY.invalidSelection));
        }
    }
});

registerRoutine('shipyards_equipment', (ctx) => {
    echoCommand(ctx, 'shipyardsEquipment');
    ctx.world.mode = Menu.ShipyardsClass0;
});

// Shared by both the shipyards class-0 (build new ship) menu and the
// in-port class-0 trade menu. Inline preamble + askNumber → Buy* — no
// downstream qty menu (class0Qty / shipyardsClass0Qty are gone).
async function chooseClass0(
    ctx: import('../types.js').GameContext,
    kind: 'drones' | 'shields' | 'holds',
    echoKey: 'buyDrones' | 'buyShields' | 'buyHolds',
): Promise<void> {
    echoCommand(ctx, echoKey);
    const { promptText, max } = class0QtyPreamble(ctx, kind);
    if (max <= 0) return;
    // Empty Enter accepts max; cap upper bound so server doesn't bounce
    // an over-buy. min: 1 → 0 returns null (cancel).
    const qty = await askNumber(ctx, promptText, { defaultValue: max, min: 1, max });
    if (qty === null) return;
    if (kind === 'drones') ctx.io.sendMsg({ type: ClientMsgType.BuyDrones, quantity: qty });
    else if (kind === 'shields') ctx.io.sendMsg({ type: ClientMsgType.BuyShields, quantity: qty });
    else ctx.io.sendMsg({ type: ClientMsgType.BuyHolds, quantity: qty });
}

registerRoutine('choose_holds', (ctx) => chooseClass0(ctx, 'holds', 'buyHolds'));
registerRoutine('choose_drones', (ctx) => chooseClass0(ctx, 'drones', 'buyDrones'));
registerRoutine('choose_shields', (ctx) => chooseClass0(ctx, 'shields', 'buyShields'));

registerRoutine('leave_port', (ctx) => {
    echoCommand(ctx, 'undock');
    ctx.io.sendMsg({ type: ClientMsgType.Undock });
});
