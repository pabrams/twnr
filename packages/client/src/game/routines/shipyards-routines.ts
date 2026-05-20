import { ClientTag, Menu, ServerTag, type ShipCatalogEntry } from '@twnr/shared';
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
import { COMMON, COMPUTER, EVENT, NOTIFY, STARBASE } from '../messages/index.js';
import { registerRoutine } from './types.js';
import { askChar, askConfirm, askNumber, awaitResponse } from './prompts.js';
import { promptShipName } from '../handlers/ship-name.js';

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
        const isTradein = yes;
        ctx.io.sendMsg(
            isTradein
                ? { type: ClientTag.BuyShipTradein, targetShipName: ship.name }
                : { type: ClientTag.BuyShipNew, targetShipName: ship.name },
        );
        // Server validates the buy, then pushes ShipNameRequired so we can
        // ask the player to name the new ship. Once SetShipName completes,
        // the server commits the purchase and sends BuyShipNew/TradeinResult.
        const nameReq = await awaitResponse(ctx, [ServerTag.ShipNameRequired, ServerTag.Error]);
        if (nameReq === null) return;
        if (nameReq.type !== ServerTag.ShipNameRequired) return;
        const typeLabel = nameReq.shipTypeDisplayName ?? nameReq.shipTypeName;
        const promptTpl = isTradein ? EVENT.shipNamePromptTradein : EVENT.shipNamePromptBuyNew;
        await promptShipName(ctx, promptTpl, typeLabel);
        // The buy-result handler (handlers/ship-exchange.ts) renders the
        // "ship purchased / traded" message + updates ctx.ship state when
        // the response arrives; we just wait so the routine owns the paint.
        await awaitResponse(ctx, [
            isTradein ? ServerTag.BuyShipTradeinResult : ServerTag.BuyShipNewResult,
            ServerTag.Error,
        ]);
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

async function chooseClass0(
    ctx: import('../types.js').GameContext,
    kind: 'drones' | 'shields' | 'holds',
    echoKey: 'buyDrones' | 'buyShields' | 'buyHolds',
): Promise<void> {
    echoCommand(ctx, echoKey);
    const { promptText, max } = class0QtyPreamble(ctx, kind);
    if (max <= 0) return;
    const qty = await askNumber(ctx, promptText, { defaultValue: max, min: 1, max });
    if (qty === null) return;
    if (kind === 'drones') ctx.io.sendMsg({ type: ClientTag.BuyDrones, quantity: qty });
    else if (kind === 'shields') ctx.io.sendMsg({ type: ClientTag.BuyShields, quantity: qty });
    else ctx.io.sendMsg({ type: ClientTag.BuyHolds, quantity: qty });
}

registerRoutine('choose_holds', (ctx) => chooseClass0(ctx, 'holds', 'buyHolds'));
registerRoutine('choose_drones', (ctx) => chooseClass0(ctx, 'drones', 'buyDrones'));
registerRoutine('choose_shields', (ctx) => chooseClass0(ctx, 'shields', 'buyShields'));

registerRoutine('leave_port', (ctx) => {
    echoCommand(ctx, 'undock');
    ctx.io.sendMsg({ type: ClientTag.Undock });
});
