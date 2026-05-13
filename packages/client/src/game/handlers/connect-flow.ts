import { ClientTag, ServerTag } from '@twnr/shared';
import type { WelcomeEvent } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { EVENT } from '../messages/index.js';
import { askConfirm, awaitResponse } from '../menus/prompts.js';
import { renderMailEntries } from '../display-mail.js';
import { promptShipName } from './ship-name.js';

type ConnectFlowCtx = Pick<GameContext, 'io' | 'input'>;

/**
 * Single async orchestrator that runs whenever a Welcome envelope arrives.
 * Server invariants (routeMessage gate, mail-since-last-logout query) stay
 * authoritative; this routine just drives the client-side sequence:
 *
 *   1. If the player has no ship, drive the name prompt. Server's
 *      routeMessage gate would reject any other command until SetShipName
 *      lands anyway, so this step has to run first.
 *   2. CheckMailSinceLastLogout + render inbox + optional delete prompt.
 *   3. Trigger a location-aware re-display via the input pipeline so the
 *      normal `<Re-Display>` echo + sector/planet/starbase paint happens.
 */
export async function runConnectFlow(ctx: ConnectFlowCtx, msg: WelcomeEvent): Promise<void> {
    if (msg.shipName === '' && msg.startingShip) {
        const typeLabel = msg.startingShip.typeDisplayName ?? msg.startingShip.typeName;
        await promptShipName(ctx, EVENT.shipNamePromptInitial, typeLabel);
    }
    await checkConnectMail(ctx);
    ctx.io.submitLineFromMap('');
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
