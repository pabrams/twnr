import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { CLAN } from '../messages/index.js';
import type { Handler } from './index.js';

type ClanContext = Pick<GameContext, 'io'>;

export const memoDelivery: Handler<'memoDelivery', ClanContext> = (ctx, msg) => {
    if (msg.memos.length === 0) return;
    ctx.io.term.writeln(render(CLAN.incomingMemoHeader));
    for (const m of msg.memos) {
        ctx.io.term.writeln(
            render(CLAN.incomingMemoLine, {
                from: m.senderName ?? 'System',
                body: m.body,
            }),
        );
    }
};

type ClanMembershipContext = Pick<GameContext, 'player'>;

export const clanMembershipChanged: Handler<'clanMembershipChanged', ClanMembershipContext> = (
    ctx,
    msg,
) => {
    ctx.player.clanId = msg.clanId;
};
