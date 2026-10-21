import { ClientTag, ServerTag } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { EVENT } from '../messages/index.js';
import { askLineRaw } from '../routines/prompts.js';
import { awaitResponse } from '../routines/io.js';

type ShipNamePromptCtx = Pick<GameContext, 'io' | 'input' | 'player'>;

const MAX_SHIP_NAME_LENGTH = 20;
const DEFAULT_NAME_SUFFIX = "'s ship";

/** `<player>'s ship`, truncated so it fits the name limit. */
function defaultShipName(playerName: string): string {
    const stem = playerName
        .trim()
        .slice(0, MAX_SHIP_NAME_LENGTH - DEFAULT_NAME_SUFFIX.length)
        .trim();
    return stem === '' ? 'Unnamed ship' : `${stem}${DEFAULT_NAME_SUFFIX}`;
}

/** Re-prompts until the server accepts; cancellation is intentionally unsupported — the
 *  server gates all other commands until naming completes. Blank input takes the default;
 *  promptTemplate renders with { type, default }. */
export async function promptShipName(
    ctx: ShipNamePromptCtx,
    promptTemplate: string,
    shipTypeDisplayName: string,
): Promise<void> {
    const fallback = defaultShipName(ctx.player.name);
    while (true) {
        const raw = await askLineRaw(
            ctx,
            render(promptTemplate, { type: shipTypeDisplayName, default: fallback }),
        );
        if (raw === null) continue; // no cancel — keep asking
        const name = raw.trim() === '' ? fallback : raw.trim();
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
