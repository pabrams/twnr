import { ServerTag } from '@twnr/shared';
import type { TowAttachCommand, TowableMannedEntry, TowableUnmannedEntry } from '@twnr/shared';
import { onlinePlayers } from '../state/players.js';
import { sendEnvelope } from '../state/messaging.js';
import { AbortTransaction } from '../db/index.js';
import { runMutation } from './run-mutation.js';
import {
    getMannedTowables,
    getUnmannedTowables,
    setTowedShip,
    clearTowedShip,
    getTowState,
    lockTowTarget,
} from '../db/queries/tow.js';
import { getShipTurnsPerWarp } from '../db/queries/ship.js';
import { getPlayerClanId } from '../db/queries/clan.js';

/** Total turns-per-warp for the tower when towing another ship. */
export function combinedTurnsPerWarp(selfTpw: number, towedTpw: number): number {
    return selfTpw + 2 * towedTpw;
}

export async function serveTowSpacecraft(playerId: number): Promise<void> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    // Already towing? Detach.
    const state = await getTowState(playerId);
    if (state) {
        await clearTowedShip(playerId);
        sendEnvelope(playerId, {
            type: ServerTag.TowSpacecraftResult,
            outcome: 'disengaged',
            message: 'You shut off your Tractor Beam.',
        });
        return;
    }

    const clanId = await getPlayerClanId(playerId);
    const [manned, unmanned] = await Promise.all([
        getMannedTowables(playerId, player.sectorId),
        getUnmannedTowables(playerId, clanId, player.sectorId),
    ]);

    const mannedEntries: TowableMannedEntry[] = manned.map((r) => ({
        playerId: r.player_id,
        playerName: r.player_name,
        clanNumber: r.clan_number,
        shipId: r.ship_id,
        shipName: r.ship_name,
        shipTypeName: r.ship_type_name,
        shipTypeDisplayName: r.ship_type_display_name,
        drones: r.ship_drones,
    }));

    const unmannedEntries: TowableUnmannedEntry[] = unmanned.map((r) => {
        let ownership: TowableUnmannedEntry['ownership'];
        if (r.owner_player_id !== null) {
            ownership = {
                kind: 'player',
                name: r.owner_player_name ?? '',
                playerId: r.owner_player_id,
                ownerClanNumber: r.owner_player_clan_number,
            };
        } else if (r.owner_clan_id !== null) {
            ownership = {
                kind: 'clan',
                name: r.owner_clan_name ?? 'Clan',
                clanNumber: r.owner_clan_number ?? 0,
                clanId: r.owner_clan_id,
            };
        } else {
            ownership = { kind: 'rogue' };
        }
        return {
            shipId: r.ship_id,
            shipName: r.ship_name,
            shipTypeName: r.ship_type_name,
            shipTypeDisplayName: r.ship_type_display_name,
            drones: r.ship_drones,
            ownership,
        };
    });

    if (mannedEntries.length === 0 && unmannedEntries.length === 0) {
        sendEnvelope(playerId, { type: ServerTag.TowSpacecraftResult, outcome: 'none' });
        return;
    }

    sendEnvelope(playerId, {
        type: ServerTag.TowSpacecraftResult,
        outcome: 'options',
        sector: player.sector,
        manned: mannedEntries,
        unmanned: unmannedEntries,
    });
}

export async function serveTowAttach(playerId: number, data: TowAttachCommand): Promise<void> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    const clanId = await getPlayerClanId(playerId);

    await runMutation(
        playerId,
        'tow attach',
        async (client) => {
            const target = await lockTowTarget(data.shipId, client);
            if (!target) {
                sendEnvelope(playerId, {
                    type: ServerTag.TowAttachResult,
                    outcome: 'error',
                    message: 'That ship is no longer here.',
                });
                throw new AbortTransaction();
            }

            // Re-verify same sector after acquiring the lock — a concurrent
            // move could have warped the target away.
            if (target.ship_sector_id !== player.sectorId) {
                sendEnvelope(playerId, {
                    type: ServerTag.TowAttachResult,
                    outcome: 'error',
                    message: 'That ship is no longer here.',
                });
                throw new AbortTransaction();
            }

            const isManned = target.pilot_player_id !== null;

            if (isManned) {
                if (target.ship_drones > 0) {
                    sendEnvelope(playerId, {
                        type: ServerTag.TowAttachResult,
                        outcome: 'error',
                        message: 'You cannot tow a manned ship that has fighters on it.',
                    });
                    throw new AbortTransaction();
                }
            } else {
                const ownedByPlayer = target.owner_player_id === playerId;
                const ownedByClan =
                    clanId !== null &&
                    target.owner_clan_id !== null &&
                    target.owner_clan_id === clanId;
                if (!ownedByPlayer && !ownedByClan) {
                    sendEnvelope(playerId, {
                        type: ServerTag.TowAttachResult,
                        outcome: 'error',
                        message: 'You do not own that ship.',
                    });
                    throw new AbortTransaction();
                }
            }

            const selfTpw =
                player.shipId !== null ? await getShipTurnsPerWarp(playerId, client) : 1;
            const tpw = combinedTurnsPerWarp(selfTpw, target.ship_turns_per_warp);

            await setTowedShip(playerId, data.shipId, client);

            const targetName = isManned
                ? `${target.pilot_player_name}'s ${
                      target.ship_type_display_name ?? target.ship_type_name
                  }`
                : target.ship_name;

            return {
                tpw,
                targetName,
                pilotPlayerId: target.pilot_player_id,
            };
        },
        (result) => {
            sendEnvelope(playerId, {
                type: ServerTag.TowAttachResult,
                outcome: 'ok',
                message: `You lock your Tractor Beam on ${result.targetName}`,
                turnsPerWarp: result.tpw,
            });

            // Manned target: alert the pilot that they're being towed.
            if (result.pilotPlayerId !== null && onlinePlayers[result.pilotPlayerId]) {
                sendEnvelope(result.pilotPlayerId, {
                    type: ServerTag.TowAttachedAlert,
                    towingName: player.name,
                });
            }
        },
        () =>
            sendEnvelope(playerId, {
                type: ServerTag.TowAttachResult,
                outcome: 'error',
                message: 'Internal server error.',
            }),
    );
}
