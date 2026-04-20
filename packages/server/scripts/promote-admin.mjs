import pg from 'pg';
const { Pool } = pg;

const email = process.env.ADMIN_EMAIL || process.argv[2];
if (!email) {
    console.error('Usage: ADMIN_EMAIL=you@example.com node promote-admin.mjs');
    console.error('   or: node promote-admin.mjs you@example.com');
    process.exit(2);
}

const pool = new Pool({
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
});

try {
    const res = await pool.query(
        `UPDATE users SET role = 'admin' WHERE email = $1 RETURNING id, email, role`,
        [email],
    );
    if (res.rowCount === 0) {
        console.log(`No user with email ${email} yet — skipping promotion.`);
    } else {
        console.log(`Promoted ${res.rows[0].email} to admin.`);
    }
} catch (err) {
    console.error('promote-admin failed:', err);
    process.exit(1);
} finally {
    await pool.end();
}
