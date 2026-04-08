import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
});

async function grantTurns() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get all universes with turns enabled (settings in edits table)
        const univRes = await client.query(
            `SELECT u.id, COALESCE(e.turns_per_day, 500) as turns_per_day, COALESCE(e.max_turns, 2000) as max_turns
             FROM universes u LEFT JOIN edits e ON u.edit_id = e.id
             WHERE COALESCE(e.turns_per_day, 500) > 0`,
        );

        let totalUpdated = 0;

        for (const univ of univRes.rows) {
            const hourlyRate = Math.floor(univ.turns_per_day / 24);
            if (hourlyRate <= 0) continue;

            // Select players with row-level locking
            const playersRes = await client.query(
                `SELECT id, turns, last_turns_granted_at
                 FROM players
                 WHERE universe_id = $1
                 FOR UPDATE`,
                [univ.id],
            );

            for (const player of playersRes.rows) {
                const elapsedMs = Date.now() - new Date(player.last_turns_granted_at).getTime();
                const elapsedHours = Math.floor(elapsedMs / (1000 * 60 * 60));

                if (elapsedHours < 1) continue;

                const turnsToGrant = elapsedHours * hourlyRate;
                const newTurns = Math.min(player.turns + turnsToGrant, univ.max_turns);

                await client.query(
                    'UPDATE players SET turns = $1, last_turns_granted_at = NOW() WHERE id = $2',
                    [newTurns, player.id],
                );

                totalUpdated++;
            }
        }

        await client.query('COMMIT');
        console.log(totalUpdated);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error granting turns:', err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
        process.exit(0);
    }
}

grantTurns();
