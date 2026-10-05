import { ServerTag, type StatsSnapshot } from '@twnr/shared';
import { sendEnvelope } from '../state/messaging.js';
import { getStatsSnapshotRow } from '../db/queries/player.js';
import { getPlayerShipHardware } from '../db/queries/hardware.js';

/**
 * Single round-trip snapshot of every field rendered in the right-side stats
 * column. Pushed after every routed client message and on async events (combat,
 * mail, time-based) that change a tracked field.
 *
 * Returns null when the player has no ship (e.g. between respawn and re-entry);
 * caller should skip the push in that case.
 */
export async function buildStatsSnapshot(playerId: number): Promise<StatsSnapshot | null> {
    const row = await getStatsSnapshotRow(playerId);
    if (!row || row.ship_type_slug === null) return null;

    const hwRows = await getPlayerShipHardware(playerId);
    const hardware: Record<string, number> = {};
    for (const h of hwRows) hardware[h.name] = h.quantity;

    const used = row.fuel + row.organics + row.equipment + row.colonists;
    return {
        type: ServerTag.StatsSnapshot,
        sector: row.sector_number ?? 0,
        turns: row.turns,
        experience: row.experience,
        alignment: row.reputation,
        credits: row.credits,
        shipTypeName: row.ship_type_slug,
        shipTypeDisplayName: row.ship_type_display_name,
        holds: {
            fuel: row.fuel,
            organics: row.organics,
            equipment: row.equipment,
            colonists: row.colonists,
            empty: Math.max(0, row.holds - used),
            total: row.holds,
        },
        ship: {
            drones: row.drones,
            shields: row.shields,
            maxDroneAttack: row.max_drone_attack,
        },
        hardware,
    };
}

/** Build + send the snapshot. No-op when the player has no active ship. */
export async function sendStatsSnapshot(playerId: number): Promise<void> {
    const snap = await buildStatsSnapshot(playerId);
    if (!snap) return;
    await sendEnvelope(playerId, snap);
}
