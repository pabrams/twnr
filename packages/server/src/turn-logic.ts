import { pool } from './db/index.js';

export async function checkAndDeductTurns(
    playerId: number,
    universeId: number,
    cost: number,
    queryFn?: { query: (text: string, params?: any[]) => Promise<any> },
): Promise<{ allowed: boolean; turnsUsed: number }> {
    const db = queryFn ?? pool;
    const univRes = await db.query(
        `SELECT COALESCE(e.turns_per_day, 500) as turns_per_day
         FROM universes u LEFT JOIN edits e ON u.edit_id = e.id WHERE u.id = $1`,
        [universeId],
    );
    if (univRes.rows[0].turns_per_day === 0) return { allowed: true, turnsUsed: 0 };
    const playerRes = await db.query('SELECT turns FROM players WHERE id = $1', [playerId]);
    if (playerRes.rows[0].turns < cost) return { allowed: false, turnsUsed: 0 };
    await db.query('UPDATE players SET turns = turns - $1 WHERE id = $2', [cost, playerId]);
    return { allowed: true, turnsUsed: cost };
}
