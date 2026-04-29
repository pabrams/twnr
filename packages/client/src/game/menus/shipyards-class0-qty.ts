import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { class0MaxBuy } from '../display-port.js';
import { showShipyardsClass0QtyPrompt } from '../display-starbase.js';
import { registerMenu, getMenuArgs } from './types.js';

registerMenu(Menu.ShipyardsClass0Qty, {
    renderPrompt(ctx) {
        const kind = getMenuArgs(ctx, Menu.ShipyardsClass0Qty)?.kind;
        if (kind) showShipyardsClass0QtyPrompt(ctx, kind);
    },
    input(ctx, line) {
        const trimmed = line.trim();
        if (trimmed.toLowerCase() === 'q') {
            echoCommand(ctx, 'shipyardsEquipment');
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipyardsClass0 });
            return;
        }
        const kind = getMenuArgs(ctx, Menu.ShipyardsClass0Qty)?.kind;
        if (!kind) return;
        const max = class0MaxBuy(kind, ctx);
        const qty = trimmed === '' ? max : parseInt(trimmed, 10);
        if (isNaN(qty) || qty < 0) {
            ctx.io.term.writeln('Enter a non-negative number.');
            return;
        }
        if (qty === 0) {
            echoCommand(ctx, 'shipyardsEquipment');
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipyardsClass0 });
            return;
        }
        switch (kind) {
            case 'drones':
                ctx.io.sendMsg({ type: ClientMsgType.BuyDrones, quantity: qty });
                break;
            case 'shields':
                ctx.io.sendMsg({ type: ClientMsgType.BuyShields, quantity: qty });
                break;
            case 'holds':
                ctx.io.sendMsg({ type: ClientMsgType.BuyHolds, quantity: qty });
                break;
        }
    },
});
