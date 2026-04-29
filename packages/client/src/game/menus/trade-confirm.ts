import { ClientMsgType, Menu } from '@twnr/shared';
import { registerMenu } from './types.js';

// TradeConfirm has no `enter`: its prompt is rendered by the
// TradeConfirmRequest result handler, not by MenuChanged.
registerMenu(Menu.TradeConfirm, {
    input(ctx, line) {
        switch (line.toLowerCase()) {
            case '':
            case 'y':
                ctx.sendMsg({ type: ClientMsgType.TradeConfirmResponse, confirmed: true });
                break;
            case 'n':
                ctx.sendMsg({ type: ClientMsgType.TradeConfirmResponse, confirmed: false });
                break;
        }
    },
});
