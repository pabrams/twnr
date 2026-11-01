import type { PoolClient } from 'pg';
import type {
    CommandName,
    CommandReply,
    CommandRequest,
    Refusal,
    RefusalDetail,
    RefusalReason,
} from '@twnr/shared';
import { withTransaction, AbortTransaction } from '../db/index.js';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A command's reply without the wire `type`, which the router stamps on. Includes the `refused` outcome. */
export type ReplyBody<K extends CommandName> = DistributiveOmit<CommandReply<K>, 'type'>;

/** What a handler returns: the reply body, or nothing for commands defined with `reply: null`. */
export type CommandResult<K extends CommandName> = [CommandReply<K>] extends [never]
    ? void
    : ReplyBody<K>;

export type Handler<K extends CommandName> = (
    playerId: number,
    request: CommandRequest<K>,
) => Promise<CommandResult<K>> | CommandResult<K>;

/** The server understood the command but the game state does not allow it. */
export function commandRefusal(reason: RefusalReason, detail?: RefusalDetail): Refusal {
    return detail === undefined
        ? { outcome: 'refused', reason }
        : { outcome: 'refused', reason, detail };
}

/** `throw abort(reply)` rolls back the `mutateAndReply` transaction, skips `onSuccess`, and answers with `reply`. */
export type Abort<R> = (reply: R) => AbortTransaction;

/**
 * Runs `tx` in a transaction and maps its result to the command's reply.
 * `R` is inferred from the handler's declared return type, so replies passed
 * to `abort` are checked against the command's reply schema. Any throw other
 * than an abort propagates as a server fault.
 */
export async function mutateAndReply<T, R>(
    tx: (client: PoolClient, abort: Abort<R>) => Promise<T>,
    onSuccess: (result: T) => R | Promise<R>,
): Promise<R> {
    const abort: Abort<R> = (reply) => new AbortTransaction(reply);
    try {
        const result = await withTransaction((client) => tx(client, abort));
        return await onSuccess(result);
    } catch (err) {
        if (err instanceof AbortTransaction) return err.reply as R;
        throw err;
    }
}
