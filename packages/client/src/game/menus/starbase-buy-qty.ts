import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { showBuyQtyPrompt } from '../display-starbase.js';
import { registerMenu, getMenuArgs } from './types.js';

registerMenu(Menu.StarbaseBuyQty, {
    renderPrompt(ctx) {
        const args = getMenuArgs(ctx, Menu.StarbaseBuyQty);
        showBuyQtyPrompt(ctx, args?.label ?? '', args?.defaultQty ?? 0);
    },
    input(ctx, line) {
        const trimmed = line.trim();
        const args = getMenuArgs(ctx, Menu.StarbaseBuyQty);
        // Q or 0 cancels back to the hardware menu.
        if (trimmed.toLowerCase() === 'q' || trimmed === '0') {
            echoCommand(ctx, 'hardwareStoreInfo');
            ctx.io.sendMsg({ type: ClientMsgType.HardwareStoreInfo });
            return;
        }
        // Empty Enter → accept default (max we can buy). If the default is 0, cancel.
        const qty = trimmed === '' ? (args?.defaultQty ?? 0) : parseInt(trimmed, 10);
        if (qty === 0) {
            echoCommand(ctx, 'hardwareStoreInfo');
            ctx.io.sendMsg({ type: ClientMsgType.HardwareStoreInfo });
            return;
        }
        if (isNaN(qty) || qty < 0) {
            ctx.io.term.writeln('Enter a non-negative number (0 to cancel).');
            return;
        }
        const itemName = args?.itemName;
        if (itemName) {
            ctx.io.sendMsg({ type: ClientMsgType.BuyHardware, itemName, quantity: qty });
        }
    },
});
