import { ClientMsgType, Menu } from '@twnr/shared';
import { registerMenu } from './types.js';

registerMenu(Menu.TradeConfirm, {
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
