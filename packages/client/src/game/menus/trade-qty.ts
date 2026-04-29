import { ClientMsgType, Menu } from '@twnr/shared';
import { registerMenu } from './types.js';

// TradeQty has no `enter`: its prompt is rendered by the TradeQtyResult
// handler in connection.ts, not by MenuChanged.
registerMenu(Menu.TradeQty, {
    input(ctx, line) {
        const trimmed = line.trim();
        // Empty input = accept default
        const qty = trimmed === '' ? -1 : parseInt(trimmed, 10);
        if (isNaN(qty) || qty < -1) return;
        // -1 signals "use default maxQty" to the server, 0 = skip. The
        // <Trade at Port> echo already fired when the user pressed T at
        // the port menu; no echo at this step.
        ctx.sendMsg({ type: ClientMsgType.TradeResponse, quantity: qty === -1 ? -1 : qty });
    },
});
