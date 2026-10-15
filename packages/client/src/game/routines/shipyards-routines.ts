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
import { askChar, askConfirm, askNumber } from './prompts.js';
import { awaitResponse } from './io.js';
import { loadShipCatalog } from './catalogs.js';
import { promptShipName } from '../handlers/ship-name.js';

/** Trade-in credit for the ship currently flown: its catalog base cost. */
function getCurrentShipPrice(ctx: GameContext, ships: ShipCatalogEntry[]): number {
    if (!ctx.ship.currentShipName) return 0;
    const ship = ships.find((s) => s.name === ctx.ship.currentShipName);
    return ship?.baseCost ?? 0;
}

registerRoutine('buy_ship', async (ctx) => {
    echoCommand(ctx, 'shipyardsBuy');
    const ships = await loadShipCatalog(ctx);
    if (!ships || ships.length === 0) return;
    showShipBuyList(ctx, ships);
    const letters = ships.map((_, i) => indexToLetter(i).toLowerCase());
    const allowed = [...letters, '?'];
    while (true) {
        const ch = await askChar(ctx, render(STARBASE.shipyardsBuyPrompt), allowed);
        if (ch === null) return;
        if (ch === '?') {
            showShipBuyList(ctx, ships);
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
        const price = ship.baseCost;
        const tradein = getCurrentShipPrice(ctx, ships);
        showTradeinInfo(ctx, ship.displayName ?? ship.name, price, tradein);
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
    const ships = await loadShipCatalog(ctx);
    if (!ships || ships.length === 0) return;
    showShipExamineList(ctx, ships);
    const letters = ships.map((_, i) => indexToLetter(i).toLowerCase());
    const allowed = [...letters, '?'];
    while (true) {
        const ch = await askChar(ctx, render(COMPUTER.shipInterestPrompt), allowed);
        if (ch === null) return;
        if (ch === '?') {
            showShipExamineList(ctx, ships);
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
