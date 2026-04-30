import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { PORT } from '../messages/index.js';
import { registerMenu, getMenuArgs } from './types.js';

registerMenu(Menu.TradeQty, {
    renderPrompt(ctx) {
        const args = getMenuArgs(ctx, Menu.TradeQty);
        if (!args) return;
        const { term } = ctx.io;
        const infoTpl = args.action === 'buy' ? PORT.tradeQtyInfoBuy : PORT.tradeQtyInfoSell;
        const promptTpl = args.action === 'buy' ? PORT.tradeQtyPromptBuy : PORT.tradeQtyPromptSell;
        term.writeln('');
        term.writeln(render(infoTpl, { portTrading: args.portTrading, onBoard: args.onBoard }));
        term.write(render(promptTpl, { commodity: args.commodity, maxQty: args.maxQty }));
    },
    input(ctx, line) {
        const trimmed = line.trim();
        const qty = trimmed === '' ? -1 : parseInt(trimmed, 10);
        if (isNaN(qty) || qty < -1) return;
        ctx.io.sendMsg({ type: ClientMsgType.TradeResponse, quantity: qty === -1 ? -1 : qty });
    },
});
