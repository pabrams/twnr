import { ClientTag, ServerTag } from '@twnr/shared';
import type { WelcomeEvent } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { EVENT } from '../messages/index.js';
import { askConfirm, askLine, awaitResponse } from '../menus/prompts.js';
import { renderMailEntries } from '../display-mail.js';

type ConnectFlowCtx = Pick<GameContext, 'io' | 'input'>;

const MAX_SHIP_NAME_LENGTH = 20;

/**
 * Single async orchestrator that runs whenever a Welcome envelope arrives.
 * Server invariants (routeMessage gate, mail-since-last-logout query) stay
 * authoritative; this routine just drives the client-side sequence:
 *
 *   1. If the player has no ship, drive the name prompt (loops on validation
 *      errors). Server's routeMessage gate would reject any other command
 *      until SetShipName lands anyway, so this step has to run first.
 *   2. CheckMailSinceLastLogout + render inbox + optional delete prompt.
 *   3. Trigger a location-aware re-display via the input pipeline so the
 *      normal `<Re-Display>` echo + sector/planet/starbase paint happens.
 */
export async function runConnectFlow(ctx: ConnectFlowCtx, msg: WelcomeEvent): Promise<void> {
    if (msg.shipName === '' && msg.startingShip) {
        await promptForShipName(ctx, msg.startingShip);
    }
    await checkConnectMail(ctx);
    ctx.io.submitLineFromMap('');
}

async function promptForShipName(
    ctx: ConnectFlowCtx,
    startingShip: NonNullable<WelcomeEvent['startingShip']>,
): Promise<void> {
    const typeLabel = startingShip.typeDisplayName ?? startingShip.typeName;
    while (true) {
        const raw = await askLine(ctx, render(EVENT.shipNamePromptInitial, { type: typeLabel }));
        if (raw === null) continue; // shipless players cannot bail; reprompt.
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

async function checkConnectMail(ctx: ConnectFlowCtx): Promise<void> {
    ctx.io.sendMsg({ type: ClientTag.CheckMailSinceLastLogout });
    const reply = await awaitResponse(ctx, [ServerTag.MemoDelivery, ServerTag.Error]);
    if (reply === null) return;
    if (reply.type !== ServerTag.MemoDelivery) return;
    ctx.io.term.writeln(render(EVENT.mailConnectHeader));
    if (reply.memos.length === 0) {
        ctx.io.term.writeln(render(EVENT.mailNoneReceived));
        return;
    }
    renderMailEntries(ctx, reply.memos);
    const del = await askConfirm(ctx, render(EVENT.mailDeletePrompt), { defaultValue: false });
    if (del) ctx.io.sendMsg({ type: ClientTag.DeleteAllMail });
}
