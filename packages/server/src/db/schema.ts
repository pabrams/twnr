import { pool } from './pool.js';

let isConnected = false;

export const connectDB = async (): Promise<void> => {
    if (isConnected) return;

    try {
        const client = await pool.connect();

        // Create tables
        await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'player',
        token_version INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS universes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        seed INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sectors (
        id INTEGER NOT NULL,
        universe_id INTEGER NOT NULL REFERENCES universes(id),
        name VARCHAR(255),
        PRIMARY KEY (id, universe_id)
      );

      CREATE TABLE IF NOT EXISTS warps (
        sector_from INTEGER NOT NULL,
        sector_to INTEGER NOT NULL,
        universe_id INTEGER NOT NULL REFERENCES universes(id),
        PRIMARY KEY (sector_from, sector_to, universe_id)
      );

      CREATE TABLE IF NOT EXISTS players (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        user_id INTEGER NOT NULL REFERENCES users(id),
        universe_id INTEGER NOT NULL REFERENCES universes(id),
        current_sector INTEGER,
        ship_destroyed_date TIMESTAMPTZ,
        docked BOOLEAN NOT NULL DEFAULT FALSE,
        UNIQUE (user_id, universe_id)
      );

      CREATE TABLE IF NOT EXISTS ports (
        id SERIAL PRIMARY KEY,
        sector_id INTEGER NOT NULL,
        universe_id INTEGER NOT NULL REFERENCES universes(id),
        class INTEGER NOT NULL,
        fuel INTEGER NOT NULL DEFAULT 1000,
        fuel_price INTEGER NOT NULL,
        organics INTEGER NOT NULL DEFAULT 1000,
        org_price INTEGER NOT NULL,
        equipment INTEGER NOT NULL DEFAULT 1000,
        equ_price INTEGER NOT NULL,
        UNIQUE (sector_id, universe_id)
      );

      CREATE TABLE IF NOT EXISTS planets (
        id SERIAL PRIMARY KEY,
        sector_id INTEGER NOT NULL,
        universe_id INTEGER NOT NULL REFERENCES universes(id),
        name VARCHAR(255) NOT NULL,
        type VARCHAR(255) NOT NULL DEFAULT 'Terran',
        colonists INTEGER NOT NULL DEFAULT 0,
        UNIQUE (sector_id, universe_id)
      );

      CREATE TABLE IF NOT EXISTS ship_cargo (
        player_id INTEGER PRIMARY KEY,
        fuel INTEGER NOT NULL DEFAULT 0,
        organics INTEGER NOT NULL DEFAULT 0,
        equipment INTEGER NOT NULL DEFAULT 0,
        colonists INTEGER NOT NULL DEFAULT 0,
        credits INTEGER NOT NULL DEFAULT 10000
      );

      CREATE TABLE IF NOT EXISTS visited_sectors (
        player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        sector_id INTEGER NOT NULL,
        PRIMARY KEY (player_id, sector_id)
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
