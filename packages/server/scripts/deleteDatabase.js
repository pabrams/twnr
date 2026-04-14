import { Pool } from 'pg';

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
    
    await client.query(`
      DROP TABLE IF EXISTS menu_command CASCADE;
      DROP TABLE IF EXISTS command CASCADE;
      DROP TABLE IF EXISTS sector_drones CASCADE;
      DROP TABLE IF EXISTS planet_collisions CASCADE;
      DROP TABLE IF EXISTS planets CASCADE;
      DROP TABLE IF EXISTS visited_sectors CASCADE;
      DROP TABLE IF EXISTS ship_hardware CASCADE;
      DROP TABLE IF EXISTS ships CASCADE;
      DROP TABLE IF EXISTS ship_type_hardware CASCADE;
      DROP TABLE IF EXISTS ship_types_edits CASCADE;
      DROP TABLE IF EXISTS ship_types CASCADE;
      DROP TABLE IF EXISTS hardware_price CASCADE;
      DROP TABLE IF EXISTS hardware_item CASCADE;
      DROP TABLE IF EXISTS ports CASCADE;
      DROP TABLE IF EXISTS warps CASCADE;
      DROP TABLE IF EXISTS players CASCADE;
      DROP TABLE IF EXISTS sectors CASCADE;
      DROP TABLE IF EXISTS universes CASCADE;
      DROP TABLE IF EXISTS edits CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
      DROP TABLE IF EXISTS menu CASCADE;
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
