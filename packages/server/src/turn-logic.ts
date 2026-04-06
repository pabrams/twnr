import { pool } from './db/index.js';

export async function checkAndDeductTurns(
    playerId: number,
    universeId: number,
    cost: number,
): Promise<{ allowed: boolean; turnsUsed: number }> {
    const univRes = await pool.query('SELECT turns_per_day FROM universes WHERE id = $1', [
        universeId,
    ]);
    if (univRes.rows[0].turns_per_day === 0) return { allowed: true, turnsUsed: 0 };
    const playerRes = await pool.query('SELECT turns FROM players WHERE id = $1', [playerId]);
    if (playerRes.rows[0].turns < cost) return { allowed: false, turnsUsed: 0 };
    await pool.query('UPDATE players SET turns = turns - $1 WHERE id = $2', [cost, playerId]);
    return { allowed: true, turnsUsed: cost };
}
