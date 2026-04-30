import { ClientMsgType, Menu } from '@twnr/shared';
import { registerMenu } from './types.js';

registerMenu(Menu.TradeQty, {
    input(ctx, line) {
        const trimmed = line.trim();
        const qty = trimmed === '' ? -1 : parseInt(trimmed, 10);
        if (isNaN(qty) || qty < -1) return;
        ctx.io.sendMsg({ type: ClientMsgType.TradeResponse, quantity: qty === -1 ? -1 : qty });
    },
});
