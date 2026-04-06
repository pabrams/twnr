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
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        max_planets_per_sector SMALLINT NOT NULL DEFAULT 2,
        planet_collision_likelihood SMALLINT NOT NULL DEFAULT 50,
        planet_collision_min_hours SMALLINT NOT NULL DEFAULT 24,
        planet_collision_max_hours SMALLINT NOT NULL DEFAULT 24,
        turns_per_day INTEGER NOT NULL DEFAULT 500,
        starting_turns INTEGER NOT NULL DEFAULT 500,
        max_turns INTEGER NOT NULL DEFAULT 2000
      );

      ALTER TABLE universes ADD COLUMN IF NOT EXISTS max_planets_per_sector SMALLINT NOT NULL DEFAULT 2;
      ALTER TABLE universes ADD COLUMN IF NOT EXISTS planet_collision_likelihood SMALLINT NOT NULL DEFAULT 50;
      ALTER TABLE universes ADD COLUMN IF NOT EXISTS planet_collision_min_hours SMALLINT NOT NULL DEFAULT 24;
      ALTER TABLE universes ADD COLUMN IF NOT EXISTS planet_collision_max_hours SMALLINT NOT NULL DEFAULT 24;
      ALTER TABLE universes ADD COLUMN IF NOT EXISTS turns_per_day INTEGER NOT NULL DEFAULT 500;
      ALTER TABLE universes ADD COLUMN IF NOT EXISTS starting_turns INTEGER NOT NULL DEFAULT 500;
      ALTER TABLE universes ADD COLUMN IF NOT EXISTS max_turns INTEGER NOT NULL DEFAULT 2000;

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
        on_planet_id INTEGER DEFAULT NULL,
        turns INTEGER NOT NULL DEFAULT 0,
        last_turns_granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, universe_id)
      );

      ALTER TABLE players ADD COLUMN IF NOT EXISTS on_planet_id INTEGER DEFAULT NULL;
      ALTER TABLE players ADD COLUMN IF NOT EXISTS turns INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE players ADD COLUMN IF NOT EXISTS last_turns_granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

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

      DO $$ 
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='planets' AND column_name='colonists') THEN
          DROP TABLE planets CASCADE;
        END IF;
      END $$;

      CREATE TABLE IF NOT EXISTS planets (
        id INTEGER NOT NULL,
        sector_id INTEGER NOT NULL,
        universe_id INTEGER NOT NULL REFERENCES universes(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(255) NOT NULL DEFAULT 'Terran',
        fighters SMALLINT NOT NULL DEFAULT 0,
        fuel SMALLINT NOT NULL DEFAULT 0,
        organics SMALLINT NOT NULL DEFAULT 0,
        equipment SMALLINT NOT NULL DEFAULT 0,
        colonists_fuel SMALLINT NOT NULL DEFAULT 0,
        colonists_organics SMALLINT NOT NULL DEFAULT 0,
        colonists_equipment SMALLINT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ,
        PRIMARY KEY (id, universe_id),
        FOREIGN KEY (sector_id, universe_id) REFERENCES sectors(id, universe_id) ON DELETE CASCADE
      );

      CREATE OR REPLACE FUNCTION trigger_set_timestamp()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS set_timestamp_planets ON planets;
      CREATE TRIGGER set_timestamp_planets
      BEFORE UPDATE ON planets
      FOR EACH ROW
      EXECUTE FUNCTION trigger_set_timestamp();

      DO $$ 
      BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE table_name='planet_collisions' AND constraint_name='planet_collisions_collision_planet_universe_id_fkey'
        ) THEN
            DROP TABLE IF EXISTS planet_collisions CASCADE;
        END IF;
      END $$;

      CREATE TABLE IF NOT EXISTS planet_collisions (
        collision_planet INTEGER NOT NULL,
        colliding_with INTEGER NOT NULL,
        universe_id INTEGER NOT NULL REFERENCES universes(id) ON DELETE CASCADE,
        collision_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (collision_planet, colliding_with, universe_id),
        FOREIGN KEY (collision_planet, universe_id) REFERENCES planets(id, universe_id) ON DELETE CASCADE,
        FOREIGN KEY (colliding_with, universe_id) REFERENCES planets(id, universe_id) ON DELETE CASCADE
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
        cargo_limit INTEGER NOT NULL,
        planet_busters SMALLINT NOT NULL DEFAULT 0,
        terraform_devices SMALLINT NOT NULL DEFAULT 0,
        turns_per_warp INTEGER NOT NULL DEFAULT 1,
        has_hyperwarp_drive BOOLEAN NOT NULL DEFAULT FALSE
      );

      ALTER TABLE player_ships ADD COLUMN IF NOT EXISTS planet_busters SMALLINT NOT NULL DEFAULT 0;
      ALTER TABLE player_ships ADD COLUMN IF NOT EXISTS terraform_devices SMALLINT NOT NULL DEFAULT 0;
      ALTER TABLE player_ships ADD COLUMN IF NOT EXISTS turns_per_warp INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE player_ships ADD COLUMN IF NOT EXISTS has_hyperwarp_drive BOOLEAN NOT NULL DEFAULT FALSE;

      CREATE TABLE IF NOT EXISTS sector_fighters (
        sector_id INTEGER NOT NULL,
        universe_id INTEGER NOT NULL REFERENCES universes(id),
        owner_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL,
        PRIMARY KEY (sector_id, universe_id)
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
