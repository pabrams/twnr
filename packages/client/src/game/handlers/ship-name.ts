import { ClientTag, ServerTag } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { EVENT } from '../messages/index.js';
import { askLine, awaitResponse } from '../menus/prompts.js';

type ShipNamePromptCtx = Pick<GameContext, 'io' | 'input'>;

const MAX_SHIP_NAME_LENGTH = 20;

/**
 * Drive the "name your ship" prompt loop and complete the SetShipName /
 * SetShipNameResult round trip. Re-prompts on invalid input (blank, too
 * long, server-rejected). Cancellation is intentionally not supported —
 * the server gates all other commands until naming completes.
 *
 * `promptTemplate` is rendered with `{ type: shipTypeDisplayName }`.
 */
export async function promptShipName(
    ctx: ShipNamePromptCtx,
    promptTemplate: string,
    shipTypeDisplayName: string,
): Promise<void> {
    while (true) {
        const raw = await askLine(ctx, render(promptTemplate, { type: shipTypeDisplayName }));
        if (raw === null) continue; // no cancel — keep asking
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
        if (reply.outcome === 'ok') return;
        ctx.io.term.writeln(
            render(EVENT.shipNameInvalid, { message: reply.message ?? 'Invalid ship name.' }),
        );
    }
}
