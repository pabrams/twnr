import { Pool } from 'pg';

export const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'twnr',
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
});

let isConnected = false;

export const connectDB = async (): Promise<void> => {
    if (isConnected) return;

    try {
        const client = await pool.connect();

        // Create tables
        await client.query(`
      CREATE TABLE IF NOT EXISTS sectors (
        id INTEGER PRIMARY KEY,
        name VARCHAR(255)
      );
      
      CREATE TABLE IF NOT EXISTS warps (
        sector_from INTEGER NOT NULL REFERENCES sectors(id),
        sector_to INTEGER NOT NULL REFERENCES sectors(id),
        PRIMARY KEY (sector_from, sector_to)
      );
      
      CREATE TABLE IF NOT EXISTS players (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        email VARCHAR(255) UNIQUE,
        password_hash VARCHAR(255),
        role VARCHAR(50) NOT NULL DEFAULT 'player',
        current_sector INTEGER REFERENCES sectors(id)
      );
      ALTER TABLE players ADD COLUMN IF NOT EXISTS email VARCHAR(255);
      ALTER TABLE players ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
      ALTER TABLE players ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'player';
      ALTER TABLE players ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;
      CREATE UNIQUE INDEX IF NOT EXISTS players_email_unique_idx ON players (email) WHERE email IS NOT NULL;

      CREATE TABLE IF NOT EXISTS ports (
        id SERIAL PRIMARY KEY,
        sector_id INTEGER NOT NULL UNIQUE REFERENCES sectors(id),
        class INTEGER NOT NULL,
        fuel INTEGER NOT NULL DEFAULT 1000,
        fuel_price INTEGER NOT NULL,
        organics INTEGER NOT NULL DEFAULT 1000,
        org_price INTEGER NOT NULL,
        equipment INTEGER NOT NULL DEFAULT 1000,
        equ_price INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ship_cargo (
        player_id INTEGER PRIMARY KEY,
        fuel INTEGER NOT NULL DEFAULT 0,
        organics INTEGER NOT NULL DEFAULT 0,
        equipment INTEGER NOT NULL DEFAULT 0,
        credits INTEGER NOT NULL DEFAULT 10000
      );

      CREATE TABLE IF NOT EXISTS player_ships (
        player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
        ship_name VARCHAR(255) NOT NULL,
        fighters INTEGER NOT NULL DEFAULT 0,
        shields INTEGER NOT NULL DEFAULT 0,
        cargo_limit INTEGER NOT NULL
      );
    `);

        client.release();
        isConnected = true;
        console.log('PostgreSQL connected and schema verified');
    } catch (error) {
        console.error('PostgreSQL connection error:', error);
        process.exit(1);
    }
};
