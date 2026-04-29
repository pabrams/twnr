import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { showBuyQtyPrompt } from '../display-starbase.js';
import { registerMenu } from './types.js';

registerMenu(Menu.StarbaseBuyQty, {
    enter(ctx) {
        showBuyQtyPrompt(ctx, ctx.starbaseBuyLabel ?? '', ctx.starbaseBuyDefault);
    },
    input(ctx, line) {
        const trimmed = line.trim();
        // Q or 0 cancels back to the hardware menu.
        if (trimmed.toLowerCase() === 'q' || trimmed === '0') {
            echoCommand(ctx, 'hardwareStoreInfo');
            ctx.sendMsg({ type: ClientMsgType.HardwareStoreInfo });
            return;
        }
        // Empty Enter → accept default (max we can buy). If the default is 0, cancel.
        const qty = trimmed === '' ? ctx.starbaseBuyDefault : parseInt(trimmed, 10);
        if (qty === 0) {
            echoCommand(ctx, 'hardwareStoreInfo');
            ctx.sendMsg({ type: ClientMsgType.HardwareStoreInfo });
            return;
        }
        if (isNaN(qty) || qty < 0) {
            ctx.term.writeln('Enter a non-negative number (0 to cancel).');
            return;
        }
        const itemName = ctx.starbaseBuyItemName;
        if (itemName) {
            ctx.sendMsg({ type: ClientMsgType.BuyHardware, itemName, quantity: qty });
        }
    },
});
