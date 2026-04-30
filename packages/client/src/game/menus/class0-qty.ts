import { ClientMsgType, Menu } from '@twnr/shared';
import { class0MaxBuy, showClass0QtyPrompt } from '../display-port.js';
import { echoCommand } from '../display.js';
import { registerMenu, getMenuArgs } from './types.js';

registerMenu(Menu.Class0Qty, {
    renderPrompt(ctx) {
        const kind = getMenuArgs(ctx, Menu.Class0Qty)?.kind;
        if (kind) showClass0QtyPrompt(ctx, kind);
    },
    input(ctx, line) {
        const trimmed = line.trim();
        if (trimmed.toLowerCase() === 'q') {
            echoCommand(ctx, 'class0QtyBack');
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Class0 });
            return;
        }
        const kind = getMenuArgs(ctx, Menu.Class0Qty)?.kind;
        if (!kind) return;
        const max = class0MaxBuy(kind, ctx);
        const qty = trimmed === '' ? max : parseInt(trimmed, 10);
        if (isNaN(qty) || qty < 0) {
            ctx.io.term.writeln('Enter a non-negative number.');
            return;
        }
        if (qty === 0) {
            echoCommand(ctx, 'class0QtyBack');
            ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Class0 });
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
