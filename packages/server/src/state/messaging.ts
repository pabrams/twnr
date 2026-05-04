import type { WebSocket } from 'ws';
import type { ServerResult, MenuName } from '@twnr/shared';
import { ServerMsgType } from '@twnr/shared';
import { players, setPlayerMenu } from './players.js';

/**
 * Wire format: every server-to-client message is a flat object with `type`
 * and `menu` fields plus whatever payload data the result type carries.
 * Handlers build `ServerResult` (no menu); this layer stamps `menu` on
 * before sending.
 */
function frame(menu: MenuName, body?: ServerResult, suppressPrompt?: boolean): string {
    const flag = suppressPrompt ? { suppressPrompt: true } : {};
    if (body) {
        return JSON.stringify({ ...body, ...flag, menu });
    }
    return JSON.stringify({ type: ServerMsgType.MenuTransition, ...flag, menu });
}

/**
 * Send a result. If `menu` is provided, also transitions the recipient
 * (`setPlayerMenu` is called before the frame is serialized, so the wire
 * frame and persisted state agree). If `menu` is omitted, the recipient
 * stays in their current menu and the frame is stamped with that.
 *
 * Handlers should pass `menu` whenever the result represents a menu
 * change — collapses the previous `setPlayerMenu` + `sendEnvelope` pair
 * into one call and keeps the two side-effects atomic.
 *
 * Pass `opts.suppressPrompt: true` when the envelope is a transient
 * step in a multi-message server-driven flow (e.g. DockResult that will
 * be followed by TradePrompt or UndockResult). The client framework
 * then skips its auto renderPrompt, so the menu prompt doesn't paint
 * between the transient and the message that actually owns the next
 * user-facing prompt.
 */
export async function sendEnvelope(
    playerId: number,
    body: ServerResult,
    menu?: MenuName,
    opts?: { suppressPrompt?: boolean },
): Promise<void> {
    const player = players[playerId];
    if (!player || player.ws.readyState !== 1) return;
    if (menu) {
        await setPlayerMenu(playerId, menu);
    }
    const menuToStamp = (menu ?? player.currentMenu) as MenuName;
    player.ws.send(frame(menuToStamp, body, opts?.suppressPrompt));
}

/**
 * Pure menu transition with no data payload. The framework on the client
 * mirrors the `menu` field into `ctx.world.mode` and re-renders the menu's
 * prompt. Used by `handleChangeMenu` and similar flows.
 */
export async function sendTransition(playerId: number, menu: MenuName): Promise<void> {
    const player = players[playerId];
    if (!player || player.ws.readyState !== 1) return;
    await setPlayerMenu(playerId, menu);
    player.ws.send(frame(menu));
}

/**
 * Emit an Error result. Stays in the current menu by default; pass `menu`
 * when the error should also transition (e.g. handlers that pre-set a
 * destination menu and then encounter a recoverable failure).
 */
export function sendError(playerId: number, message: string, menu?: MenuName): void {
    const player = players[playerId];
    if (!player || player.ws.readyState !== 1) return;
    if (menu) {
        // Fire-and-forget: setPlayerMenu writes the DB but the in-memory
        // mutation is synchronous, so the frame below already sees the
        // new menu via player.currentMenu.
        void setPlayerMenu(playerId, menu);
    }
    const currentMenu = (player.currentMenu ?? 'sector') as MenuName;
    player.ws.send(frame(currentMenu, { type: ServerMsgType.Error, message }));
}

/**
 * Close the WebSocket of a destroyed player with a 1008 policy-violation
 * frame carrying the reason text. All destruction sites (combat, mines,
 * future planet-collisions, etc.) call this after their reason-specific
 * payload (AttackShipResult, MoveResult-destroyed, ProximityMineHit, ...)
 * has been sent, so the client always sees the same terminal step.
 */
export function closeDestroyedSession(playerId: number, reason: string): void {
    const player = players[playerId];
    if (!player || player.ws.readyState !== 1) return;
    player.ws.close(1008, reason);
}

/**
 * Broadcast a result to multiple WebSocket clients. The `menu` stamped on
 * each frame is the recipient's current menu — broadcasts don't transition
 * anyone (they're notifications, e.g. "another player joined this sector").
 */
export function broadcastTo(data: ServerResult, targetClients: Set<WebSocket> | WebSocket[]): void {
    for (const client of targetClients) {
        if (client.readyState === 1) {
            const entry = Object.values(players).find((p) => p.ws === client);
            const menu = (entry?.currentMenu ?? 'sector') as MenuName;
            client.send(frame(menu, data));
        }
    }
}

/**
 * Like broadcastTo but addresses by player id instead of WebSocket. Used
 * when callers already have a list of target playerIds (e.g. "everyone in
 * this universe").
 */
export function broadcastEnvelope(data: ServerResult, targetPlayerIds: number[]): void {
    for (const pid of targetPlayerIds) {
        const player = players[pid];
        if (player && player.ws.readyState === 1) {
            player.ws.send(frame(player.currentMenu as MenuName, data));
        }
    }
}
