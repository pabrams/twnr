import { Menu, type ShipCatalogEntry, Commands, command } from '@twnr/shared';
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
import { promptShipName } from './ship-name.js';

function currentShipTradeInCredit(ctx: GameContext, ships: ShipCatalogEntry[]): number {
    if (!ctx.ship.currentShipTypeName) return 0;
    const ship = ships.find((s) => s.name === ctx.ship.currentShipTypeName);
    return ship?.baseCost ?? 0;
}

registerRoutine('buyShip', async (ctx) => {
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
        if (ship.name === ctx.ship.currentShipTypeName) {
            ctx.io.term.writeln(render(COMMON.errorLine, { text: 'Already flying that ship.' }));
            continue;
        }
        const price = ship.baseCost;
        const tradein = currentShipTradeInCredit(ctx, ships);
        showTradeinInfo(ctx, ship.displayName ?? ship.name, price, tradein);
        const yes = await askConfirm(ctx, render(STARBASE.tradeinConfirm));
        if (yes === null) continue;
        const isTradein = yes;
        const promptTpl = isTradein ? EVENT.shipNamePromptTradein : EVENT.shipNamePromptBuyNew;
        const name = await promptShipName(ctx, promptTpl, ship.displayName ?? ship.name);
        if (name === null) return;
        ctx.io.sendMsg(
            isTradein
                ? command(Commands.BuyShipTradein, { targetShipName: ship.name, name })
                : command(Commands.BuyShipNew, { targetShipName: ship.name, name }),
        );
        // The buy-result handler renders the outcome; await only so the routine owns the paint.
        await awaitResponse(ctx, [
            isTradein ? Commands.BuyShipTradein.reply.name : Commands.BuyShipNew.reply.name,
        ]);
        return;
    }
});

registerRoutine('examineShips', async (ctx) => {
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

registerRoutine('shipyardsEquipment', (ctx) => {
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
    if (kind === 'drones') ctx.io.sendMsg(command(Commands.BuyDrones, { quantity: qty }));
    else if (kind === 'shields') ctx.io.sendMsg(command(Commands.BuyShields, { quantity: qty }));
    else ctx.io.sendMsg(command(Commands.BuyHolds, { quantity: qty }));
}

registerRoutine('chooseHolds', (ctx) => chooseClass0(ctx, 'holds', 'buyHolds'));
registerRoutine('chooseDrones', (ctx) => chooseClass0(ctx, 'drones', 'buyDrones'));
registerRoutine('chooseShields', (ctx) => chooseClass0(ctx, 'shields', 'buyShields'));

registerRoutine('leavePort', (ctx) => {
    echoCommand(ctx, 'undock');
    ctx.io.sendMsg(command(Commands.Undock, {}));
});
