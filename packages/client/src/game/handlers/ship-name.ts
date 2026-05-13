import { ClientTag, ServerTag } from '@twnr/shared';
import { render } from '../renderer.js';
import { EVENT } from '../messages/index.js';
import { askLine, awaitResponse } from '../menus/prompts.js';
import type { Handler } from './index.js';

const MAX_SHIP_NAME_LENGTH = 40;

const PROMPT_TEMPLATE_BY_REASON = {
    initial: EVENT.shipNamePromptInitial,
    respawn: EVENT.shipNamePromptRespawn,
    buyNew: EVENT.shipNamePromptBuyNew,
    tradein: EVENT.shipNamePromptTradein,
} as const;

export const shipNameRequired: Handler<'shipNameRequired'> = async (ctx, msg) => {
    while (true) {
        const tpl = PROMPT_TEMPLATE_BY_REASON[msg.reason];
        const raw = await askLine(ctx, render(tpl, { type: msg.shipTypeDisplayName }));
        if (raw === null) return;
        const name = raw.trim();
        if (name.length === 0) {
            ctx.io.term.writeln(
                render(EVENT.shipNameInvalid, { message: 'Ship name cannot be blank.' }),
            );
            continue;
        }
        if (name.length > MAX_SHIP_NAME_LENGTH) {
            ctx.io.term.writeln(
                render(EVENT.shipNameInvalid, {
                    message: `Ship name too long (max ${MAX_SHIP_NAME_LENGTH}).`,
                }),
            );
            continue;
        }
        ctx.io.sendMsg({ type: ClientTag.SetShipName, name });
        const reply = await awaitResponse(ctx, [ServerTag.SetShipNameResult, ServerTag.Error]);
        if (reply === null) return;
        if (reply.type !== ServerTag.SetShipNameResult) return;
        if (reply.outcome === 'ok') {
            // Mirror the welcome flow: kick off the connect-mail check now
            // that the player has a ship. memoDelivery (reason='connect')
            // chains the location-aware re-display when it finishes.
            ctx.io.sendMsg({ type: ClientTag.CheckMailSinceLastLogout });
            return;
        }
        ctx.io.term.writeln(
            render(EVENT.shipNameInvalid, { message: reply.message ?? 'Invalid ship name.' }),
        );
    }
};
