import { Pool } from 'pg';

export const pool = new Pool({
  host: 'localhost',
  database: 'twnr',
  user: 'twnr_user',
  password: 'twnr_pass',
});

let isConnected = false;

export const connectDB = async (): Promise<void> => {
  if (isConnected) return;

  try {
    const client = await pool.connect();
    
    // Create tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS sectors (
        id INTEGER PRIMARY KEY
      );
      
      CREATE TABLE IF NOT EXISTS warps (
        sector_from INTEGER NOT NULL REFERENCES sectors(id),
        sector_to INTEGER NOT NULL REFERENCES sectors(id),
        PRIMARY KEY (sector_from, sector_to)
      );
      
      CREATE TABLE IF NOT EXISTS players (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        current_sector INTEGER REFERENCES sectors(id)
      );

      CREATE TABLE IF NOT EXISTS ports (
        id SERIAL PRIMARY KEY,
        sector_id INTEGER NOT NULL UNIQUE REFERENCES sectors(id),
        fuel INTEGER NOT NULL DEFAULT 1000,
        organics INTEGER NOT NULL DEFAULT 1000,
        equipment INTEGER NOT NULL DEFAULT 1000
      );

      CREATE TABLE IF NOT EXISTS ship_cargo (
        player_id INTEGER PRIMARY KEY,
        fuel INTEGER NOT NULL DEFAULT 0,
        organics INTEGER NOT NULL DEFAULT 0,
        equipment INTEGER NOT NULL DEFAULT 0,
        credits INTEGER NOT NULL DEFAULT 10000
      );
    `);
    
    client.release();
    isConnected = true;
    console.log("PostgreSQL connected and schema verified");
  } catch (error) {
    console.error("PostgreSQL connection error:", error);
    process.exit(1);
  }
};
