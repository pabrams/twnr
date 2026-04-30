import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { TRANSACTION } from '../messages/index.js';
import { registerMenu, getMenuArgs } from './types.js';
import { fmt } from '../handlers/utils.js';

registerMenu(Menu.TradeConfirm, {
    renderPrompt(ctx) {
        const args = getMenuArgs(ctx, Menu.TradeConfirm);
        const { term } = ctx.io;
        if (args) {
            const tpl =
                args.action === 'buy' ? TRANSACTION.tradeConfirmSell : TRANSACTION.tradeConfirmBuy;
            term.writeln(render(tpl, { total: fmt(args.totalPrice) }));
        }
        term.write(render(TRANSACTION.tradeConfirmAccept));
    },
    input(ctx, line) {
        switch (line.toLowerCase()) {
            case '':
            case 'y':
                ctx.io.sendMsg({ type: ClientMsgType.TradeConfirmResponse, confirmed: true });
                break;
            case 'n':
                ctx.io.sendMsg({ type: ClientMsgType.TradeConfirmResponse, confirmed: false });
                break;
        }
    },
});
