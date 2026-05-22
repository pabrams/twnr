import { ServerTag, type StatsSnapshot } from '@twnr/shared';
import { pool } from '../db/index.js';
import { sendEnvelope } from '../state/messaging.js';

type StatsRow = {
    sector_number: number | null;
    turns: number;
    credits: number;
    reputation: number;
    experience: number;
    ship_type_slug: string;
    ship_type_display_name: string | null;
    drones: number;
    shields: number;
    holds: number;
    fuel: number;
    organics: number;
    equipment: number;
    colonists: number;
};

/**
 * Single round-trip snapshot of every field rendered in the right-side stats
 * column. Pushed after every routed client message and on async events (combat,
 * mail, time-based) that change a tracked field.
 *
 * Returns null when the player has no ship (e.g. between respawn and re-entry);
 * caller should skip the push in that case.
 */
export async function buildStatsSnapshot(playerId: number): Promise<StatsSnapshot | null> {
    const res = await pool.query<StatsRow>(
        `SELECT sec.sector_number,
                p.turns, p.credits, p.reputation, p.experience,
                s.ship_type_slug,
                st.display_name AS ship_type_display_name,
                s.drones, s.shields, s.holds,
                s.fuel, s.organics, s.equipment, s.colonists
         FROM players p
         LEFT JOIN sectors sec ON sec.id = p.current_sector_id
         LEFT JOIN ships s ON s.id = p.ship_id
         LEFT JOIN universe_ship_types st
           ON st.universe_id = s.universe_id AND st.slug = s.ship_type_slug
         WHERE p.id = $1`,
        [playerId],
    );
    const row = res.rows[0];
    if (!row || row.ship_type_slug === null) return null;

    const hwRes = await pool.query<{ name: string; quantity: number }>(
        `SELECT hi.name, sh.quantity
         FROM ship_hardware sh
         JOIN hardware_item hi ON hi.id = sh.hardware_item_id
         JOIN players p ON p.ship_id = sh.ship_id
         WHERE p.id = $1`,
        [playerId],
    );
    const hardware: Record<string, number> = {};
    for (const h of hwRes.rows) hardware[h.name] = h.quantity;

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
