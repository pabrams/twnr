import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dropSQL = readFileSync(join(__dirname, 'drop-all-tables.sql'), 'utf8');

async function deleteDatabase() {
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'twnr',
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  });

  try {
    console.log("Connecting to database...");
    const client = await pool.connect();
    console.log("connected");

    await client.query(dropSQL);

    console.log('Database tables deleted successfully');
    client.release();
  } catch (error) {
    console.error('Error deleting the database tables:', error);
  } finally {
    await pool.end();
  }
}

deleteDatabase();
