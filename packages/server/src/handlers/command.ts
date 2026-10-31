import type { PoolClient } from 'pg';
import type { CommandName, CommandReply, CommandRequest } from '@twnr/shared';
import { withTransaction, AbortTransaction } from '../db/index.js';

const COMMAND_ERROR = Symbol('commandError');

export type CommandError = { readonly [COMMAND_ERROR]: true; readonly message: string };

export function commandError(message: string): CommandError {
    return { [COMMAND_ERROR]: true, message };
}

export function isCommandError(value: unknown): value is CommandError {
    return typeof value === 'object' && value !== null && COMMAND_ERROR in value;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type ReplyBody<K extends CommandName> = DistributiveOmit<CommandReply<K>, 'type'>;

export type CommandResult<K extends CommandName> = [CommandReply<K>] extends [never]
    ? CommandError | void
    : ReplyBody<K> | CommandError | undefined;

export type Handler<K extends CommandName> = (
    playerId: number,
    request: CommandRequest<K>,
) => Promise<CommandResult<K>> | CommandResult<K>;

export function abort(reply: unknown): AbortTransaction {
    return new AbortTransaction(reply);
}

export async function runMutation<T, R>(
    label: string,
    tx: (client: PoolClient) => Promise<T>,
    onSuccess: (result: T) => R | Promise<R>,
    failureMessage = 'Internal server error',
): Promise<R | CommandError> {
    try {
        const result = await withTransaction(tx);
        return await onSuccess(result);
    } catch (err) {
        if (err instanceof AbortTransaction) return err.reply as R | CommandError;
        console.error(`${label} error`, err);
        return commandError(failureMessage);
    }
}
