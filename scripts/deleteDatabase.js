import { Pool } from 'pg';

async function deleteDatabase() {
  const pool = new Pool({
    host: 'localhost',
    database: 'twnr',
    user: 'twnr_user',
    password: 'twnr_pass',
  });

  try {
    console.log("Connecting to database...");
    const client = await pool.connect();
    console.log("connected");
    
    await client.query(`
      DROP TABLE IF EXISTS ship_cargo CASCADE;
      DROP TABLE IF EXISTS ports CASCADE;
      DROP TABLE IF EXISTS players CASCADE;
      DROP TABLE IF EXISTS warps CASCADE;
      DROP TABLE IF EXISTS sectors CASCADE;
    `);
    
    console.log('Database tables deleted successfully');
    client.release();
  } catch (error) {
    console.error('Error deleting the database tables:', error);
  } finally {
    await pool.end();
  }
}

deleteDatabase();
