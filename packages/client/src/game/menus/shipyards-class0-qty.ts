import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { class0MaxBuy } from '../display-port.js';
import { showShipyardsClass0QtyPrompt } from '../display-starbase.js';
import { registerMenu } from './types.js';

registerMenu(Menu.ShipyardsClass0Qty, {
    enter(ctx) {
        if (ctx.class0BuyType) showShipyardsClass0QtyPrompt(ctx, ctx.class0BuyType);
    },
    input(ctx, line) {
        const trimmed = line.trim();
        if (trimmed.toLowerCase() === 'q') {
            echoCommand(ctx, 'shipyardsEquipment');
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipyardsClass0 });
            return;
        }
        const kind = ctx.class0BuyType;
        if (!kind) return;
        const max = class0MaxBuy(kind, ctx);
        const qty = trimmed === '' ? max : parseInt(trimmed, 10);
        if (isNaN(qty) || qty < 0) {
            ctx.term.writeln('Enter a non-negative number.');
            return;
        }
        if (qty === 0) {
            echoCommand(ctx, 'shipyardsEquipment');
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipyardsClass0 });
            return;
        }
        switch (kind) {
            case 'drones':
                ctx.sendMsg({ type: ClientMsgType.BuyDrones, quantity: qty });
                break;
            case 'shields':
                ctx.sendMsg({ type: ClientMsgType.BuyShields, quantity: qty });
                break;
            case 'holds':
                ctx.sendMsg({ type: ClientMsgType.BuyHolds, quantity: qty });
                break;
        }
    },
});
