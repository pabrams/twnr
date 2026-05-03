import { pool, ensureDatabase, databaseName } from './pool.js';
import { shipConfigs } from '../ship-config.js';
import { planetConfigs } from '../planet-config.js';
import { universeConfig } from '../universe-config.js';
import type { ShipConfig } from '@twnr/shared';

let isConnected = false;

export const connectDB = async (): Promise<void> => {
    if (isConnected) return;

    await ensureDatabase();
    console.log(`Using database: ${databaseName}`);

    try {
        const client = await pool.connect();
        await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'player',
        token_version INTEGER NOT NULL DEFAULT 1,
        last_connected_at TIMESTAMPTZ,
        is_guest BOOLEAN NOT NULL DEFAULT FALSE
      );

      -- Tracks which one-shot data migrations have been applied so we can
      -- skip them on subsequent boots (instead of re-running them every time).
      CREATE TABLE IF NOT EXISTS _schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Editable settings templates. Each row is a named, reusable preset
      -- whose values are interpolated from universeConfig on every boot
      -- (so editing the TS file + restarting propagates to NEW universes
      -- only). Existing universes never read from this table for settings;
      -- they have their own frozen row in universe_settings.
      --
      -- Junction tables (hardware_price, ship_types_edits, planet_types_edits)
      -- still reference templates for content-availability lookups; settings
      -- are split off into universe_settings so they can be frozen.
      CREATE TABLE IF NOT EXISTS edit_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        max_planets_per_sector SMALLINT NOT NULL DEFAULT ${universeConfig.maxPlanetsPerSector},
        planet_collision_likelihood SMALLINT NOT NULL DEFAULT ${universeConfig.planetCollisionLikelihood},
        planet_collision_min_hours SMALLINT NOT NULL DEFAULT ${universeConfig.planetCollisionMinHours},
        planet_collision_max_hours SMALLINT NOT NULL DEFAULT ${universeConfig.planetCollisionMaxHours},
        turns_per_day INTEGER NOT NULL DEFAULT ${universeConfig.turnsPerDay},
        starting_turns INTEGER NOT NULL DEFAULT ${universeConfig.startingTurns},
        max_turns INTEGER NOT NULL DEFAULT 2000,
        starting_ship VARCHAR(255) NOT NULL DEFAULT 'Vulpeculan Cruiser',
        starting_drones INTEGER NOT NULL DEFAULT 100,
        starting_credits INTEGER NOT NULL DEFAULT 10000,
        starting_port_density SMALLINT NOT NULL DEFAULT 50,
        max_port_density SMALLINT NOT NULL DEFAULT 100,
        port_production_rate SMALLINT NOT NULL DEFAULT 50,
        port_memory_hours INTEGER NOT NULL DEFAULT 48,
        max_players INTEGER NOT NULL DEFAULT 100,
        max_age_days INTEGER NOT NULL DEFAULT 0,
        max_planets INTEGER NOT NULL DEFAULT 500,
        turn_delay INTEGER NOT NULL DEFAULT ${universeConfig.turnDelay},
        is_speed_warp_delay_on BOOLEAN NOT NULL DEFAULT TRUE,
        photons_allowed BOOLEAN NOT NULL DEFAULT TRUE,
        photon_blast_time_seconds INTEGER NOT NULL DEFAULT 5,
        planet_spawn_density SMALLINT NOT NULL DEFAULT 10,
        max_ships_allowed INTEGER NOT NULL DEFAULT 500,
        max_corp_size SMALLINT NOT NULL DEFAULT 10,
        max_ships_in_protected_space SMALLINT NOT NULL DEFAULT 1,
        truce_time_hours SMALLINT NOT NULL DEFAULT 0,
        is_automation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        starting_shields INTEGER NOT NULL DEFAULT ${universeConfig.startingShields},
        starting_earth_colonists INTEGER NOT NULL DEFAULT 1000000,
        proximity_mine_damage INTEGER NOT NULL DEFAULT ${universeConfig.proximityMineDamage},
        proximity_detonation_pct SMALLINT NOT NULL DEFAULT ${universeConfig.proximityDetonationPct},
        seeker_attach_pct SMALLINT NOT NULL DEFAULT ${universeConfig.seekerAttachPct},
        seeker_pickup_detect_pct SMALLINT NOT NULL DEFAULT ${universeConfig.seekerPickupDetectPct},
        mine_disruptor_min SMALLINT NOT NULL DEFAULT ${universeConfig.mineDisruptorMin},
        mine_disruptor_max SMALLINT NOT NULL DEFAULT ${universeConfig.mineDisruptorMax}
      );

      CREATE TABLE IF NOT EXISTS universes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        seed INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        template_id INTEGER REFERENCES edit_templates(id) ON DELETE SET NULL
      );

      -- Frozen per-universe settings. Populated exactly once at universe
      -- creation by cloning the chosen template's column values. Never
      -- updated by template edits afterwards. Cascades on universe delete
      -- so there are no orphan rows.
      CREATE TABLE IF NOT EXISTS universe_settings (
        universe_id INTEGER PRIMARY KEY REFERENCES universes(id) ON DELETE CASCADE,
        max_planets_per_sector SMALLINT NOT NULL,
        planet_collision_likelihood SMALLINT NOT NULL,
        planet_collision_min_hours SMALLINT NOT NULL,
        planet_collision_max_hours SMALLINT NOT NULL,
        turns_per_day INTEGER NOT NULL,
        starting_turns INTEGER NOT NULL,
        max_turns INTEGER NOT NULL,
        starting_ship VARCHAR(255) NOT NULL,
        starting_drones INTEGER NOT NULL,
        starting_credits INTEGER NOT NULL,
        starting_port_density SMALLINT NOT NULL,
        max_port_density SMALLINT NOT NULL,
        port_production_rate SMALLINT NOT NULL,
        port_memory_hours INTEGER NOT NULL,
        max_players INTEGER NOT NULL,
        max_age_days INTEGER NOT NULL,
        max_planets INTEGER NOT NULL,
        turn_delay INTEGER NOT NULL,
        is_speed_warp_delay_on BOOLEAN NOT NULL,
        photons_allowed BOOLEAN NOT NULL,
        photon_blast_time_seconds INTEGER NOT NULL,
        planet_spawn_density SMALLINT NOT NULL,
        max_ships_allowed INTEGER NOT NULL,
        max_corp_size SMALLINT NOT NULL,
        max_ships_in_protected_space SMALLINT NOT NULL,
        truce_time_hours SMALLINT NOT NULL,
        is_automation_enabled BOOLEAN NOT NULL,
        starting_shields INTEGER NOT NULL,
        starting_earth_colonists INTEGER NOT NULL,
        proximity_mine_damage INTEGER NOT NULL DEFAULT ${universeConfig.proximityMineDamage},
        proximity_detonation_pct SMALLINT NOT NULL DEFAULT ${universeConfig.proximityDetonationPct},
        seeker_attach_pct SMALLINT NOT NULL DEFAULT ${universeConfig.seekerAttachPct},
        seeker_pickup_detect_pct SMALLINT NOT NULL DEFAULT ${universeConfig.seekerPickupDetectPct},
        mine_disruptor_min SMALLINT NOT NULL DEFAULT ${universeConfig.mineDisruptorMin},
        mine_disruptor_max SMALLINT NOT NULL DEFAULT ${universeConfig.mineDisruptorMax}
      );

      CREATE TABLE IF NOT EXISTS sectors (
        id SERIAL PRIMARY KEY,
        universe_id INTEGER NOT NULL REFERENCES universes(id) ON DELETE CASCADE,
        sector_number INTEGER NOT NULL,
        name VARCHAR(255),
        UNIQUE (universe_id, sector_number)
      );

      CREATE TABLE IF NOT EXISTS warps (
        from_sector_id INTEGER NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
        to_sector_id INTEGER NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
        PRIMARY KEY (from_sector_id, to_sector_id)
      );

      CREATE TABLE IF NOT EXISTS ship_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        display_name VARCHAR(512),
        make VARCHAR(255),
        sort_order SMALLINT NOT NULL DEFAULT 0,
        max_drones INTEGER NOT NULL DEFAULT 0,
        max_shields INTEGER NOT NULL DEFAULT 0,
        starting_holds INTEGER NOT NULL DEFAULT 5,
        max_holds INTEGER NOT NULL DEFAULT 20,
        odds_offensive REAL NOT NULL DEFAULT 1.0,
        odds_defensive REAL NOT NULL DEFAULT 1.0,
        has_pod BOOLEAN NOT NULL DEFAULT TRUE,
        can_land BOOLEAN NOT NULL DEFAULT TRUE,
        has_interdictor BOOLEAN NOT NULL DEFAULT FALSE,
        has_planetary_defense_bonus BOOLEAN NOT NULL DEFAULT FALSE,
        planetary_defense_odds REAL,
        speed SMALLINT NOT NULL DEFAULT 10,
        turns_per_warp INTEGER NOT NULL DEFAULT 2,
        cost_drive INTEGER NOT NULL DEFAULT 0,
        cost_computer INTEGER NOT NULL DEFAULT 0,
        cost_hull INTEGER NOT NULL DEFAULT 0,
        hold_cost INTEGER NOT NULL DEFAULT 0,
        max_drone_attack INTEGER NOT NULL DEFAULT 0,
        transporter_range SMALLINT NOT NULL DEFAULT 0,
        has_tractor BOOLEAN NOT NULL DEFAULT FALSE,
        piloting_restriction VARCHAR(100),
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS hardware_item (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        label VARCHAR(255) NOT NULL,
        kind VARCHAR(10) NOT NULL,
        default_price INTEGER NOT NULL,
        result_msg_type VARCHAR(100) NOT NULL,
        result_extra JSONB
      );

      CREATE TABLE IF NOT EXISTS hardware_price (
        template_id INTEGER NOT NULL REFERENCES edit_templates(id) ON DELETE CASCADE,
        hardware_item_id INTEGER NOT NULL REFERENCES hardware_item(id) ON DELETE CASCADE,
        price INTEGER NOT NULL,
        PRIMARY KEY (template_id, hardware_item_id)
      );

      CREATE TABLE IF NOT EXISTS ship_type_hardware (
        ship_type_id INTEGER NOT NULL REFERENCES ship_types(id) ON DELETE CASCADE,
        hardware_item_id INTEGER NOT NULL REFERENCES hardware_item(id) ON DELETE CASCADE,
        max_quantity INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (ship_type_id, hardware_item_id)
      );

      CREATE TABLE IF NOT EXISTS ship_types_edits (
        ship_type_id INTEGER NOT NULL REFERENCES ship_types(id) ON DELETE CASCADE,
        template_id INTEGER NOT NULL REFERENCES edit_templates(id) ON DELETE CASCADE,
        PRIMARY KEY (ship_type_id, template_id)
      );

      CREATE TABLE IF NOT EXISTS planet_types_edits (
        planet_type VARCHAR(255) NOT NULL,
        template_id INTEGER NOT NULL REFERENCES edit_templates(id) ON DELETE CASCADE,
        PRIMARY KEY (planet_type, template_id)
      );

      CREATE TABLE IF NOT EXISTS players (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        user_id INTEGER NOT NULL REFERENCES users(id),
        universe_id INTEGER NOT NULL REFERENCES universes(id),
        current_sector_id INTEGER REFERENCES sectors(id),
        previous_sector_id INTEGER REFERENCES sectors(id),
        ship_id INTEGER,
        credits INTEGER NOT NULL DEFAULT 10000,
        reputation INTEGER NOT NULL DEFAULT 0,
        experience INTEGER NOT NULL DEFAULT 0,
        ship_destroyed_date TIMESTAMPTZ,
        last_login_at TIMESTAMPTZ,
        last_logout_at TIMESTAMPTZ,
        docked BOOLEAN NOT NULL DEFAULT FALSE,
        on_planet_id INTEGER DEFAULT NULL,
        turns INTEGER NOT NULL DEFAULT 0,
        last_turns_granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, universe_id)
      );

      CREATE TABLE IF NOT EXISTS ships (
        id SERIAL PRIMARY KEY,
        owner_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
        ship_type_id INTEGER NOT NULL REFERENCES ship_types(id),
        sector_id INTEGER REFERENCES sectors(id),
        drones INTEGER NOT NULL DEFAULT 0,
        shields INTEGER NOT NULL DEFAULT 0,
        holds INTEGER NOT NULL,
        turns_per_warp INTEGER NOT NULL DEFAULT 2,
        has_density_scanner BOOLEAN NOT NULL DEFAULT TRUE,
        fuel INTEGER NOT NULL DEFAULT 0,
        organics INTEGER NOT NULL DEFAULT 0,
        equipment INTEGER NOT NULL DEFAULT 0,
        colonists INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS ship_hardware (
        ship_id INTEGER NOT NULL REFERENCES ships(id) ON DELETE CASCADE,
        hardware_item_id INTEGER NOT NULL REFERENCES hardware_item(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (ship_id, hardware_item_id)
      );

      -- FK from players.ship_id to ships.id (deferred to avoid circular dependency)
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'players_ship_id_fkey' AND table_name = 'players'
        ) THEN
          ALTER TABLE players ADD CONSTRAINT players_ship_id_fkey
            FOREIGN KEY (ship_id) REFERENCES ships(id) ON DELETE SET NULL;
        END IF;
      END $$;

      CREATE TABLE IF NOT EXISTS ports (
        id SERIAL PRIMARY KEY,
        sector_id INTEGER NOT NULL UNIQUE REFERENCES sectors(id) ON DELETE CASCADE,
        class INTEGER NOT NULL,
        fuel INTEGER NOT NULL DEFAULT 1000,
        fuel_max INTEGER NOT NULL DEFAULT 1000,
        fuel_price INTEGER NOT NULL,
        organics INTEGER NOT NULL DEFAULT 1000,
        org_max INTEGER NOT NULL DEFAULT 1000,
        org_price INTEGER NOT NULL,
        equipment INTEGER NOT NULL DEFAULT 1000,
        equ_max INTEGER NOT NULL DEFAULT 1000,
        equ_price INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS planets (
        id SERIAL PRIMARY KEY,
        sector_id INTEGER NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(255) NOT NULL DEFAULT 'Terran',
        drones SMALLINT NOT NULL DEFAULT 0,
        fuel SMALLINT NOT NULL DEFAULT 0,
        organics SMALLINT NOT NULL DEFAULT 0,
        equipment SMALLINT NOT NULL DEFAULT 0,
        colonists_fuel SMALLINT NOT NULL DEFAULT 0,
        colonists_organics SMALLINT NOT NULL DEFAULT 0,
        colonists_equipment SMALLINT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ
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

      CREATE TABLE IF NOT EXISTS planet_collisions (
        collision_planet INTEGER NOT NULL REFERENCES planets(id) ON DELETE CASCADE,
        colliding_with INTEGER NOT NULL REFERENCES planets(id) ON DELETE CASCADE,
        collision_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (collision_planet, colliding_with)
      );

      CREATE TABLE IF NOT EXISTS visited_sectors (
        player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        sector_id INTEGER NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
        PRIMARY KEY (player_id, sector_id)
      );

      CREATE TABLE IF NOT EXISTS sector_drones (
        sector_id INTEGER NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
        owner_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
        quantity INTEGER NOT NULL,
        PRIMARY KEY (sector_id)
      );

      CREATE TABLE IF NOT EXISTS command_log (
        id BIGSERIAL PRIMARY KEY,
        player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
        universe_id INTEGER NOT NULL REFERENCES universes(id) ON DELETE CASCADE,
        command_type VARCHAR(100) NOT NULL,
        payload JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_command_log_player_created
        ON command_log (player_id, created_at);

      CREATE TABLE IF NOT EXISTS menu (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        label VARCHAR(100) NOT NULL,
        parent_menu_id INTEGER REFERENCES menu(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS command (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        label VARCHAR(255) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS menu_command (
        id SERIAL PRIMARY KEY,
        menu_id INTEGER NOT NULL REFERENCES menu(id) ON DELETE CASCADE,
        command_id INTEGER NOT NULL REFERENCES command(id) ON DELETE CASCADE,
        key_pattern VARCHAR(50) NOT NULL,
        label VARCHAR(255),
        client_msg_type VARCHAR(100),
        target_menu_id INTEGER REFERENCES menu(id) ON DELETE SET NULL,
        sort_order SMALLINT NOT NULL DEFAULT 0,
        UNIQUE (menu_id, command_id)
      );

      ALTER TABLE players ADD COLUMN IF NOT EXISTS current_menu_id INTEGER REFERENCES menu(id) ON DELETE SET NULL;
    `);

        await client.query(`
      -- Sectors: protected space
      ALTER TABLE sectors ADD COLUMN IF NOT EXISTS is_protected BOOLEAN NOT NULL DEFAULT FALSE;

      -- Warps: prevent self-loops
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'warps_no_self_loop' AND table_name = 'warps'
        ) THEN
          ALTER TABLE warps ADD CONSTRAINT warps_no_self_loop
            CHECK (from_sector_id <> to_sector_id);
        END IF;
      END $$;

      ALTER TABLE players ADD COLUMN IF NOT EXISTS previous_sector_id INTEGER REFERENCES sectors(id);

      ALTER TABLE command ADD COLUMN IF NOT EXISTS generates_news BOOLEAN NOT NULL DEFAULT FALSE;

      ALTER TABLE ship_types ADD COLUMN IF NOT EXISTS basic_hold_cost INTEGER GENERATED ALWAYS AS (starting_holds * hold_cost) STORED;
      ALTER TABLE ship_types ADD COLUMN IF NOT EXISTS base_cost INTEGER GENERATED ALWAYS AS (cost_drive + cost_computer + cost_hull + starting_holds * hold_cost) STORED;

      CREATE TABLE IF NOT EXISTS planet_types (
        name VARCHAR(255) PRIMARY KEY,
        description TEXT,
        max_colonists INTEGER NOT NULL DEFAULT 0,
        max_citadel SMALLINT NOT NULL DEFAULT 0,
        fuel_production SMALLINT NOT NULL DEFAULT 0,
        organics_production SMALLINT NOT NULL DEFAULT 0,
        equipment_production SMALLINT NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS corporations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        ceo_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        universe_id INTEGER NOT NULL REFERENCES universes(id) ON DELETE CASCADE,
        UNIQUE (name, universe_id)
      );

      ALTER TABLE players ADD COLUMN IF NOT EXISTS is_knighted BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE players ADD COLUMN IF NOT EXISTS corporation_id INTEGER REFERENCES corporations(id) ON DELETE SET NULL;

      ALTER TABLE ships ADD COLUMN IF NOT EXISTS corp_owner_id INTEGER REFERENCES corporations(id) ON DELETE SET NULL;
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'ships_single_owner_type' AND table_name = 'ships'
        ) THEN
          ALTER TABLE ships ADD CONSTRAINT ships_single_owner_type
            CHECK (NOT (owner_id IS NOT NULL AND corp_owner_id IS NOT NULL));
        END IF;
      END $$;

      ALTER TABLE ports ADD COLUMN IF NOT EXISTS fuel_max INTEGER NOT NULL DEFAULT 1000;
      ALTER TABLE ports ADD COLUMN IF NOT EXISTS org_max INTEGER NOT NULL DEFAULT 1000;
      ALTER TABLE ports ADD COLUMN IF NOT EXISTS equ_max INTEGER NOT NULL DEFAULT 1000;
      ALTER TABLE ports ADD COLUMN IF NOT EXISTS name VARCHAR(255);
      ALTER TABLE ports ADD COLUMN IF NOT EXISTS fuel_buys BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE ports ADD COLUMN IF NOT EXISTS org_buys BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE ports ADD COLUMN IF NOT EXISTS equ_buys BOOLEAN NOT NULL DEFAULT TRUE;

      ALTER TABLE planets ALTER COLUMN colonists_fuel TYPE INTEGER;
      ALTER TABLE planets ALTER COLUMN colonists_organics TYPE INTEGER;
      ALTER TABLE planets ALTER COLUMN colonists_equipment TYPE INTEGER;

      ALTER TABLE planets ADD COLUMN IF NOT EXISTS shields INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE planets ADD COLUMN IF NOT EXISTS has_base BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE planets ADD COLUMN IF NOT EXISTS owner_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL;
      ALTER TABLE planets ADD COLUMN IF NOT EXISTS owner_corp_id INTEGER REFERENCES corporations(id) ON DELETE SET NULL;
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'planets_single_owner_type' AND table_name = 'planets'
        ) THEN
          ALTER TABLE planets ADD CONSTRAINT planets_single_owner_type
            CHECK (NOT (owner_player_id IS NOT NULL AND owner_corp_id IS NOT NULL));
        END IF;
      END $$;

      ALTER TABLE sector_drones ADD COLUMN IF NOT EXISTS corp_owner_id INTEGER REFERENCES corporations(id) ON DELETE SET NULL;
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'sector_drones_single_owner_type' AND table_name = 'sector_drones'
        ) THEN
          ALTER TABLE sector_drones ADD CONSTRAINT sector_drones_single_owner_type
            CHECK (NOT (owner_id IS NOT NULL AND corp_owner_id IS NOT NULL));
        END IF;
      END $$;

      CREATE TABLE IF NOT EXISTS sector_mines (
        sector_id INTEGER NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
        mine_type VARCHAR(20) NOT NULL CHECK (mine_type IN ('proximity', 'seeker')),
        quantity INTEGER NOT NULL DEFAULT 0,
        owner_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
        owner_corp_id INTEGER REFERENCES corporations(id) ON DELETE SET NULL,
        PRIMARY KEY (sector_id, mine_type),
        CHECK (NOT (owner_player_id IS NOT NULL AND owner_corp_id IS NOT NULL))
      );

      -- One row per ship that currently has a seeker mine attached. The
      -- owner_player_id is the player who deployed the mine (so they can
      -- track where their attached mines are). At most one attachment per
      -- ship; new attachments dislodge the previous mine entirely.
      CREATE TABLE IF NOT EXISTS seeker_attachments (
        ship_id INTEGER PRIMARY KEY REFERENCES ships(id) ON DELETE CASCADE,
        owner_player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        attached_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_seeker_attachments_owner
        ON seeker_attachments (owner_player_id);

      CREATE TABLE IF NOT EXISTS sector_beacons (
        sector_id INTEGER PRIMARY KEY REFERENCES sectors(id) ON DELETE CASCADE,
        owner_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
        owner_corp_id INTEGER REFERENCES corporations(id) ON DELETE SET NULL,
        message TEXT,
        CHECK (NOT (owner_player_id IS NOT NULL AND owner_corp_id IS NOT NULL))
      );

      ALTER TABLE visited_sectors ADD COLUMN IF NOT EXISTS visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE visited_sectors ADD COLUMN IF NOT EXISTS snapshot JSONB;

      CREATE TABLE IF NOT EXISTS visited_ports (
        player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        port_id INTEGER NOT NULL REFERENCES ports(id) ON DELETE CASCADE,
        visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        snapshot JSONB,
        PRIMARY KEY (player_id, port_id)
      );

      CREATE TABLE IF NOT EXISTS news (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        universe_id INTEGER NOT NULL REFERENCES universes(id) ON DELETE CASCADE,
        text TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_news_universe ON news (universe_id, created_at);

      ALTER TABLE sectors ADD COLUMN IF NOT EXISTS x DOUBLE PRECISION;
      ALTER TABLE sectors ADD COLUMN IF NOT EXISTS y DOUBLE PRECISION;

      ALTER TABLE universes
        ADD COLUMN IF NOT EXISTS topology VARCHAR(16) NOT NULL DEFAULT 'random';

      CREATE TABLE IF NOT EXISTS player_visited_sectors (
        player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        sector_id INTEGER NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (player_id, sector_id)
      );

      CREATE TABLE IF NOT EXISTS player_port_observations (
        player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        sector_id INTEGER NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
        port_class INTEGER NOT NULL,
        observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (player_id, sector_id)
      );

      CREATE TABLE IF NOT EXISTS player_planet_observations (
        player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        sector_id INTEGER NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
        planet_name TEXT NOT NULL,
        planet_type TEXT,
        observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (player_id, sector_id, planet_name)
      );
    `);

        await client.query(`
      INSERT INTO menu (name, label) VALUES
        ('sector', 'Sector'),
        ('port', 'Port'),
        ('class0', 'Class 0 Port'),
        ('class0Qty', 'Class 0 Quantity'),
        ('help', 'Help'),
        ('shipInfo', 'Ship Info'),
        ('playerInfo', 'Player Info'),
        ('attack', 'Attack'),
        ('attackDrones', 'Attack Drones'),
        ('computer', 'Computer'),
        ('knownUniverse', 'Known Universe'),
        ('shipCatalog', 'Ship Catalog'),
        ('planetSpecs', 'Planet Specs'),
        ('autopilotPrompt', 'Autopilot Prompt'),
        ('autopilot', 'Autopilot'),
        ('jettisonConfirm', 'Jettison Confirm'),
        ('planet', 'Planet'),
        ('planetTakeQty', 'Take Colonists'),
        ('planetLeaveQty', 'Leave Colonists'),
        ('deployDronesQty', 'Deploy Drones'),
        ('droneEncounter', 'Drone Encounter'),
        ('droneAttackQty', 'Drone Attack'),
        ('starbase', 'Starbase'),
        ('starbaseHardware', 'Hardware Store'),
        ('starbaseBuyQty', 'Buy Quantity'),
        ('planetSelect', 'Select Planet'),
        ('hyperspaceJumpTarget', 'Hyperspace Jump'),
        ('starbaseMines', 'Mine Type'),
        ('planetEarth', 'Earth'),
        ('planetTakeCommodity', 'Take Commodity'),
        ('planetLeaveCommodity', 'Leave Commodity'),
        ('tradeQty', 'Trade Quantity'),
        ('tradeConfirm', 'Trade Confirm'),
        ('shipyards', 'Shipyards'),
        ('shipyardsBuy', 'Buy Ship'),
        ('shipyardsTradein', 'Trade-in'),
        ('shipyardsExamine', 'Examine Ships'),
        ('shipyardsClass0', 'Shipyards Equipment'),
        ('shipyardsClass0Qty', 'Equipment Quantity'),
        ('move', 'Move to adjacent sector'),
        ('quitConfirm', 'Confirm quit'),
        ('terraformConfirm', 'Confirm terraform'),
        ('deployMines', 'Deploy Mines'),
        ('deployMinesQty', 'Deploy Mines Quantity'),
        ('mineDisruptorTarget', 'Mine Disruptor Target')
      ON CONFLICT (name) DO NOTHING;

      -- Set parent menu relationships
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'sector')
        WHERE name IN ('port', 'help', 'shipInfo', 'playerInfo', 'attack', 'computer', 'jettisonConfirm', 'planet', 'deployDronesQty');
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'port')
        WHERE name IN ('tradeQty', 'tradeConfirm');
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'port')
        WHERE name = 'class0';
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'class0')
        WHERE name = 'class0Qty';
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'attack')
        WHERE name = 'attackDrones';
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'computer')
        WHERE name IN ('knownUniverse', 'shipCatalog', 'planetSpecs', 'autopilotPrompt');
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'autopilotPrompt')
        WHERE name = 'autopilot';
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'planet')
        WHERE name IN ('planetTakeQty', 'planetLeaveQty', 'planetTakeCommodity', 'planetLeaveCommodity');
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'sector')
        WHERE name = 'planetEarth';
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'planetEarth')
        WHERE name IN ('planetTakeQty', 'planetLeaveQty');
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'droneEncounter')
        WHERE name = 'droneAttackQty';
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'sector')
        WHERE name = 'starbase';
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'starbase')
        WHERE name IN ('starbaseHardware', 'shipyards');
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'shipyards')
        WHERE name IN ('shipyardsBuy', 'shipyardsExamine', 'shipyardsClass0');
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'shipyardsBuy')
        WHERE name = 'shipyardsTradein';
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'shipyardsClass0')
        WHERE name = 'shipyardsClass0Qty';
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'starbaseHardware')
        WHERE name IN ('starbaseBuyQty', 'starbaseMines');
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'starbaseMines')
        WHERE name = 'starbaseBuyQty';
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'sector')
        WHERE name = 'planetSelect';
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'computer')
        WHERE name = 'hyperspaceJumpTarget';
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'sector')
        WHERE name IN ('deployMines', 'mineDisruptorTarget');
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'deployMines')
        WHERE name = 'deployMinesQty';

      -- Seed commands (abstract identities, reusable across menus)
      INSERT INTO command (name, label) VALUES
        -- Shared commands (used in multiple menus)
        ('back', 'Back'),
        ('players_online', 'Players online'),
        ('enter_quantity', 'Enter quantity'),
        ('confirm_yes', 'Yes'),
        ('confirm_no', 'No'),
        ('view_detail', 'View detail'),
        -- Sector commands
        ('move', 'Move to sector'),
        ('display_sector', 'Display sector'),
        ('port_menu', 'Port'),
        ('player_info', 'Player info'),
        ('help_menu', 'Help'),
        ('attack_menu', 'Attack'),
        ('computer_menu', 'Computer'),
        ('deploy_drones_info', 'Deploy drones'),
        ('jettison_menu', 'Jettison cargo'),
        ('land', 'Land on planet'),
        ('starbase_info', 'Starbase Info'),
        ('quit_game', 'Quit'),
        -- Port commands
        ('trade_at_port', 'Trade at port'),
        ('dock_starbase', 'Enter Starbase'),
        -- Docked commands
        ('buy_goods', 'Buy goods'),
        ('sell_goods', 'Sell goods'),
        ('leave_port', 'Leave port'),
        -- Class0 commands
        ('choose_drones', 'Buy drones'),
        ('choose_shields', 'Buy shields'),
        ('choose_holds', 'Buy holds'),
        -- Attack commands
        ('select_target', 'Select target'),
        -- Computer commands
        ('known_universe', 'Known Universe'),
        ('trader_list', 'List Traders'),
        ('ship_catalog', 'Ship Catalog'),
        ('planet_specs', 'Planetary Specs'),
        ('current_ship_specs', 'Current Ship'),
        -- KnownUniverse commands
        ('explored_sectors', 'Explored sectors'),
        ('unexplored_sectors', 'Unexplored sectors'),
        -- Planet commands
        ('take_colonists', 'Take colonists'),
        ('leave_colonists', 'Leave colonists'),
        -- DroneEncounter commands
        ('attack_encounter', 'Attack'),
        ('retreat', 'Retreat'),
        -- Starbase commands
        ('ship_exchange', 'Ship Exchange'),
        ('hardware_store', 'Hardware Store'),
        ('leave_starbase', 'Leave Starbase'),
        ('buy_planet_busters', 'Buy Planet Busters'),
        ('buy_terraform_devices', 'Buy Terraform Devices'),
        ('buy_hyperspace_drive', 'Buy Hyperspace Drive'),
        ('buy_buoys', 'Buy Space Buoys'),
        ('buy_mines', 'Buy Mines'),
        ('buy_proximity_mines', 'Proximity Mines'),
        ('buy_seeker_mines', 'Seeker Mines'),
        ('buy_mine_disruptors', 'Buy Mine Disruptors'),
        ('buy_scanners_visual', 'Buy Visual Scanner'),
        ('buy_scanners_planet', 'Buy Planet Scanner'),
        ('buy_cloaking_device', 'Buy Cloaking Device'),
        ('buy_corbomite', 'Buy Corbomite'),
        ('buy_photon_torpedoes', 'Buy Photon Torpedoes'),
        ('buy_recon_drones', 'Buy Recon Drones'),
        ('list_deployed_drones', 'List Deployed Drones'),
        -- Planet commands
        ('select_planet', 'Select planet'),
        ('destroy_planet', 'Destroy Planet'),
        ('use_terraform_device', 'Terraform'),
        ('planet_display', 'Planet Info'),
        ('leave_planet', 'Leave Planet'),
        -- Computer commands
        ('hyperspace_jump', 'Hyperspace Jump'),
        ('list_planets', 'Your Planets'),
        -- Commodity selection
        ('choose_fuel', 'Fuel'),
        ('choose_organics', 'Organics'),
        ('choose_equipment', 'Equipment'),
        -- Shipyards commands
        ('shipyards_menu', 'Shipyards'),
        ('buy_ship', 'Buy a new ship'),
        ('examine_ships', 'Examine ship specs'),
        ('shipyards_equipment', 'Purchase equipment'),
        ('tradein_yes', 'Trade in'),
        ('tradein_no', 'Keep old ship'),
        ('move_previous', 'Move to previous sector'),
        ('move_menu', 'Move to adjacent sector'),
        ('select_warp_1', 'Select warp 1'),
        ('select_warp_2', 'Select warp 2'),
        ('select_warp_3', 'Select warp 3'),
        ('select_warp_4', 'Select warp 4'),
        ('select_warp_5', 'Select warp 5'),
        ('select_warp_6', 'Select warp 6'),
        ('deploy_mines_menu', 'Deploy Mines'),
        ('deploy_proximity_mines', 'Proximity Mines'),
        ('deploy_seeker_mines', 'Seeker Mines'),
        ('list_deployed_mines', 'List Deployed Mines'),
        ('track_seeker_mines', 'Track Seeker Mines'),
        ('mine_disruptor_menu', 'Mine Disruptor')
      ON CONFLICT (name) DO NOTHING;

      -- Seed menu_command join rows
      -- Helper: m(menu_name), c(command_name), t(target_menu_name) via subqueries

      -- === Sector ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='move'), '<number>', 'Move to sector','move', NULL, 10),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='move_previous'), '<', 'Previous sector', NULL, NULL, 15),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='move_menu'), 'm', 'Move to adjacent sector', NULL, (SELECT id FROM menu WHERE name='move'), 25),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='port_menu'), 'p', 'Port',NULL, (SELECT id FROM menu WHERE name='port'), 30),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='player_info'), 'i', 'Player info',NULL, (SELECT id FROM menu WHERE name='playerInfo'), 40),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='help_menu'), '?', 'Help',NULL, (SELECT id FROM menu WHERE name='help'), 50),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='attack_menu'), 'a', 'Attack',NULL, (SELECT id FROM menu WHERE name='attack'), 60),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='computer_menu'), 'c', 'Computer',NULL, (SELECT id FROM menu WHERE name='computer'), 70),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='deploy_drones_info'), 'd', 'Deploy drones','deployDronesInfo', NULL, 80),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='jettison_menu'), 'j', 'Jettison cargo',NULL, (SELECT id FROM menu WHERE name='jettisonConfirm'), 90),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='land'), 'l', 'Land','land', NULL, 100),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='starbase_info'), 'v', 'Starbase info',NULL, NULL, 105),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='quit_game'), 'q', 'Quit',NULL, NULL, 110),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='players_online'), '#', 'Players online','playersOnline', NULL, 120)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Port ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='port'), (SELECT id FROM command WHERE name='trade_at_port'), 't', 'Trade at port','dock', NULL, 10),
        ((SELECT id FROM menu WHERE name='port'), (SELECT id FROM command WHERE name='dock_starbase'), 's', 'Enter Starbase','dockStarbase', NULL, 15),
        ((SELECT id FROM menu WHERE name='port'), (SELECT id FROM command WHERE name='back'), 'q', 'Back',NULL, (SELECT id FROM menu WHERE name='sector'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Class0 ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='class0'), (SELECT id FROM command WHERE name='choose_holds'), 'a', 'Cargo holds',NULL, (SELECT id FROM menu WHERE name='class0Qty'), 10),
        ((SELECT id FROM menu WHERE name='class0'), (SELECT id FROM command WHERE name='choose_drones'), 'b', 'Drones',NULL, (SELECT id FROM menu WHERE name='class0Qty'), 20),
        ((SELECT id FROM menu WHERE name='class0'), (SELECT id FROM command WHERE name='choose_shields'), 'c', 'Shield Points',NULL, (SELECT id FROM menu WHERE name='class0Qty'), 30),
        ((SELECT id FROM menu WHERE name='class0'), (SELECT id FROM command WHERE name='leave_port'), 'q', 'Quit, nevermind','undock', NULL, 40),
        ((SELECT id FROM menu WHERE name='class0'), (SELECT id FROM command WHERE name='help_menu'), '?', 'Help',NULL, NULL, 50)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Class0Qty ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='class0Qty'), (SELECT id FROM command WHERE name='enter_quantity'), '<number>', 'Enter quantity',NULL, NULL, 10),
        ((SELECT id FROM menu WHERE name='class0Qty'), (SELECT id FROM command WHERE name='back'), 'q', 'Back',NULL, (SELECT id FROM menu WHERE name='class0'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === TradeQty ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='tradeQty'), (SELECT id FROM command WHERE name='enter_quantity'), '<number>', 'Quantity to trade', NULL, NULL, 10)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === TradeConfirm ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='tradeConfirm'), (SELECT id FROM command WHERE name='confirm_yes'), 'y', 'Yes', NULL, NULL, 10),
        ((SELECT id FROM menu WHERE name='tradeConfirm'), (SELECT id FROM command WHERE name='confirm_no'), 'n', 'No', NULL, NULL, 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Help ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='help'), (SELECT id FROM command WHERE name='back'), 'q', 'Back',NULL, (SELECT id FROM menu WHERE name='sector'), 10)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === ShipInfo ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='shipInfo'), (SELECT id FROM command WHERE name='back'), 'q', 'Back',NULL, (SELECT id FROM menu WHERE name='sector'), 10)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === PlayerInfo ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='playerInfo'), (SELECT id FROM command WHERE name='back'), 'q', 'Back',NULL, (SELECT id FROM menu WHERE name='sector'), 10)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Attack ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='attack'), (SELECT id FROM command WHERE name='select_target'), '<number>', 'Select target',NULL, (SELECT id FROM menu WHERE name='attackDrones'), 10),
        ((SELECT id FROM menu WHERE name='attack'), (SELECT id FROM command WHERE name='back'), 'q', 'Back',NULL, (SELECT id FROM menu WHERE name='sector'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === AttackDrones ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='attackDrones'), (SELECT id FROM command WHERE name='enter_quantity'), '<number>', 'Drones to send','attackShip', NULL, 10),
        ((SELECT id FROM menu WHERE name='attackDrones'), (SELECT id FROM command WHERE name='back'), 'q', 'Back',NULL, (SELECT id FROM menu WHERE name='sector'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Computer ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='computer'), (SELECT id FROM command WHERE name='known_universe'), 'k', 'Known Universe',NULL, (SELECT id FROM menu WHERE name='knownUniverse'), 10),
        ((SELECT id FROM menu WHERE name='computer'), (SELECT id FROM command WHERE name='trader_list'), 'l', 'List Traders',NULL, NULL, 20),
        ((SELECT id FROM menu WHERE name='computer'), (SELECT id FROM command WHERE name='ship_catalog'), 'c', 'Ship Catalog',NULL, (SELECT id FROM menu WHERE name='shipCatalog'), 30),
        ((SELECT id FROM menu WHERE name='computer'), (SELECT id FROM command WHERE name='planet_specs'), 'j', 'Planetary Specs',NULL, (SELECT id FROM menu WHERE name='planetSpecs'), 40),
        ((SELECT id FROM menu WHERE name='computer'), (SELECT id FROM command WHERE name='current_ship_specs'), ';', 'Current Ship',NULL, NULL, 50),
        ((SELECT id FROM menu WHERE name='computer'), (SELECT id FROM command WHERE name='help_menu'), '?', 'Help',NULL, NULL, 55),
        ((SELECT id FROM menu WHERE name='computer'), (SELECT id FROM command WHERE name='back'), 'q', 'Exit Computer',NULL, (SELECT id FROM menu WHERE name='sector'), 60)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === KnownUniverse ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='knownUniverse'), (SELECT id FROM command WHERE name='explored_sectors'), 'e', 'Explored sectors',NULL, NULL, 10),
        ((SELECT id FROM menu WHERE name='knownUniverse'), (SELECT id FROM command WHERE name='unexplored_sectors'), 'u', 'Unexplored sectors',NULL, NULL, 20),
        ((SELECT id FROM menu WHERE name='knownUniverse'), (SELECT id FROM command WHERE name='back'), 'q', 'Back',NULL, (SELECT id FROM menu WHERE name='computer'), 30)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === ShipCatalog ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='shipCatalog'), (SELECT id FROM command WHERE name='view_detail'), '<letter>', 'View ship detail',NULL, NULL, 10),
        ((SELECT id FROM menu WHERE name='shipCatalog'), (SELECT id FROM command WHERE name='back'), 'q', 'Back',NULL, (SELECT id FROM menu WHERE name='computer'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === PlanetSpecs ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='planetSpecs'), (SELECT id FROM command WHERE name='view_detail'), '<letter>', 'View planet detail',NULL, NULL, 10),
        ((SELECT id FROM menu WHERE name='planetSpecs'), (SELECT id FROM command WHERE name='back'), 'q', 'Back',NULL, (SELECT id FROM menu WHERE name='computer'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === JettisonConfirm ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='jettisonConfirm'), (SELECT id FROM command WHERE name='confirm_yes'), 'y', 'Yes, jettison','jettison', (SELECT id FROM menu WHERE name='sector'), 10),
        ((SELECT id FROM menu WHERE name='jettisonConfirm'), (SELECT id FROM command WHERE name='confirm_no'), 'n', 'Cancel',NULL, (SELECT id FROM menu WHERE name='sector'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Planet ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='planet'), (SELECT id FROM command WHERE name='take_colonists'), 't', 'Take colonists',NULL, (SELECT id FROM menu WHERE name='planetTakeQty'), 10),
        ((SELECT id FROM menu WHERE name='planet'), (SELECT id FROM command WHERE name='leave_colonists'), 'l', 'Leave colonists',NULL, (SELECT id FROM menu WHERE name='planetLeaveCommodity'), 20),
        ((SELECT id FROM menu WHERE name='planet'), (SELECT id FROM command WHERE name='back'), 'q', 'Leave planet',NULL, (SELECT id FROM menu WHERE name='sector'), 30),
        ((SELECT id FROM menu WHERE name='planet'), (SELECT id FROM command WHERE name='help_menu'), '?', 'Help',NULL, NULL, 40)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === PlanetTakeQty ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='planetTakeQty'), (SELECT id FROM command WHERE name='enter_quantity'), '<number>', 'Quantity to take','takeColonists', NULL, 10),
        ((SELECT id FROM menu WHERE name='planetTakeQty'), (SELECT id FROM command WHERE name='back'), 'q', 'Back',NULL, (SELECT id FROM menu WHERE name='sector'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === PlanetLeaveQty ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='planetLeaveQty'), (SELECT id FROM command WHERE name='enter_quantity'), '<number>', 'Quantity to leave','leaveColonists', NULL, 10),
        ((SELECT id FROM menu WHERE name='planetLeaveQty'), (SELECT id FROM command WHERE name='back'), 'q', 'Back',NULL, (SELECT id FROM menu WHERE name='sector'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === DeployDronesQty ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='deployDronesQty'), (SELECT id FROM command WHERE name='enter_quantity'), '<number>', 'Drones to deploy','deployDrones', NULL, 10),
        ((SELECT id FROM menu WHERE name='deployDronesQty'), (SELECT id FROM command WHERE name='back'), 'q', 'Back',NULL, (SELECT id FROM menu WHERE name='sector'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === DroneEncounter ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='droneEncounter'), (SELECT id FROM command WHERE name='attack_encounter'), 'a', 'Attack',NULL, (SELECT id FROM menu WHERE name='droneAttackQty'), 10),
        ((SELECT id FROM menu WHERE name='droneEncounter'), (SELECT id FROM command WHERE name='retreat'), 'r', 'Retreat','retreatFromDrones', NULL, 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === DroneAttackQty ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='droneAttackQty'), (SELECT id FROM command WHERE name='enter_quantity'), '<number>', 'Drones to send','attackSectorDrones', NULL, 10),
        ((SELECT id FROM menu WHERE name='droneAttackQty'), (SELECT id FROM command WHERE name='back'), 'q', 'Back',NULL, (SELECT id FROM menu WHERE name='droneEncounter'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === AutopilotPrompt ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='autopilotPrompt'), (SELECT id FROM command WHERE name='confirm_yes'), 'y', 'Engage autopilot','move', (SELECT id FROM menu WHERE name='autopilot'), 10),
        ((SELECT id FROM menu WHERE name='autopilotPrompt'), (SELECT id FROM command WHERE name='confirm_no'), 'n', 'Cancel',NULL, (SELECT id FROM menu WHERE name='sector'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- Autopilot has no commands (input ignored during autopilot)

      -- === Starbase ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='starbase'), (SELECT id FROM command WHERE name='shipyards_menu'), 's', 'Shipyards', NULL, (SELECT id FROM menu WHERE name='shipyards'), 10),
        ((SELECT id FROM menu WHERE name='starbase'), (SELECT id FROM command WHERE name='hardware_store'), 'h', 'Hardware Store', NULL, (SELECT id FROM menu WHERE name='starbaseHardware'), 20),
        ((SELECT id FROM menu WHERE name='starbase'), (SELECT id FROM command WHERE name='list_deployed_drones'), 'd', 'Deployed Drones', 'listDeployedDrones', NULL, 30),
        ((SELECT id FROM menu WHERE name='starbase'), (SELECT id FROM command WHERE name='help_menu'), '?', 'Help', NULL, NULL, 35),
        ((SELECT id FROM menu WHERE name='starbase'), (SELECT id FROM command WHERE name='leave_starbase'), 'q', 'Leave Starbase', 'leaveStarbase', NULL, 40)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Starbase Hardware ===
      -- BANDAID: 'p' (proximity) and 's' (seeker) live here directly to match
      -- the client's flat hardware menu. Keep the starbaseMines submenu rows
      -- below for now; they are unreferenced by the client. Refactor away
      -- when the menu registry becomes the single source of dispatch.
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='starbaseHardware'), (SELECT id FROM command WHERE name='buy_terraform_devices'), 't', 'Terraform Devices', NULL, (SELECT id FROM menu WHERE name='starbaseBuyQty'), 10),
        ((SELECT id FROM menu WHERE name='starbaseHardware'), (SELECT id FROM command WHERE name='buy_planet_busters'), 'b', 'Planet Busters', NULL, (SELECT id FROM menu WHERE name='starbaseBuyQty'), 20),
        ((SELECT id FROM menu WHERE name='starbaseHardware'), (SELECT id FROM command WHERE name='buy_buoys'), 'u', 'Space Buoys', NULL, (SELECT id FROM menu WHERE name='starbaseBuyQty'), 30),
        ((SELECT id FROM menu WHERE name='starbaseHardware'), (SELECT id FROM command WHERE name='buy_seeker_mines'), 's', 'Seeker Mines', NULL, (SELECT id FROM menu WHERE name='starbaseBuyQty'), 35),
        ((SELECT id FROM menu WHERE name='starbaseHardware'), (SELECT id FROM command WHERE name='buy_mines'), 'm', 'Mines', NULL, (SELECT id FROM menu WHERE name='starbaseMines'), 40),
        ((SELECT id FROM menu WHERE name='starbaseHardware'), (SELECT id FROM command WHERE name='buy_mine_disruptors'), 'd', 'Mine Disruptors', NULL, (SELECT id FROM menu WHERE name='starbaseBuyQty'), 50),
        ((SELECT id FROM menu WHERE name='starbaseHardware'), (SELECT id FROM command WHERE name='buy_hyperspace_drive'), 'h', 'Hyperspace Drive', 'buyHyperspaceDrive', NULL, 60),
        ((SELECT id FROM menu WHERE name='starbaseHardware'), (SELECT id FROM command WHERE name='buy_scanners_visual'), 'v', 'Visual Scanner', 'buyVisualScanner', NULL, 70),
        ((SELECT id FROM menu WHERE name='starbaseHardware'), (SELECT id FROM command WHERE name='buy_scanners_planet'), 'p', 'Planet Scanner', 'buyPlanetScanner', NULL, 80),
        ((SELECT id FROM menu WHERE name='starbaseHardware'), (SELECT id FROM command WHERE name='buy_cloaking_device'), 'k', 'Cloaking Device', NULL, (SELECT id FROM menu WHERE name='starbaseBuyQty'), 90),
        ((SELECT id FROM menu WHERE name='starbaseHardware'), (SELECT id FROM command WHERE name='buy_corbomite'), 'c', 'Corbomite', NULL, (SELECT id FROM menu WHERE name='starbaseBuyQty'), 100),
        ((SELECT id FROM menu WHERE name='starbaseHardware'), (SELECT id FROM command WHERE name='buy_photon_torpedoes'), 'o', 'Photon Torpedoes', NULL, (SELECT id FROM menu WHERE name='starbaseBuyQty'), 110),
        ((SELECT id FROM menu WHERE name='starbaseHardware'), (SELECT id FROM command WHERE name='buy_recon_drones'), 'r', 'Recon Drones', NULL, (SELECT id FROM menu WHERE name='starbaseBuyQty'), 120),
        ((SELECT id FROM menu WHERE name='starbaseHardware'), (SELECT id FROM command WHERE name='help_menu'), '?', 'Help', NULL, NULL, 125),
        ((SELECT id FROM menu WHERE name='starbaseHardware'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', NULL, (SELECT id FROM menu WHERE name='starbase'), 130)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Starbase Mines submenu ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='starbaseMines'), (SELECT id FROM command WHERE name='buy_proximity_mines'), 'p', 'Proximity Mines', NULL, (SELECT id FROM menu WHERE name='starbaseBuyQty'), 10),
        ((SELECT id FROM menu WHERE name='starbaseMines'), (SELECT id FROM command WHERE name='buy_seeker_mines'), 's', 'Seeker Mines', NULL, (SELECT id FROM menu WHERE name='starbaseBuyQty'), 20),
        ((SELECT id FROM menu WHERE name='starbaseMines'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', NULL, (SELECT id FROM menu WHERE name='starbaseHardware'), 40)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- Cleanup: remove orbital mine rows from existing test DBs that were
      -- seeded before the mine system was reduced to two types. Both the
      -- hardware_item row and the menu binding referencing it.
      DELETE FROM menu_command WHERE command_id = (SELECT id FROM command WHERE name='buy_orbital_mines');
      DELETE FROM command WHERE name = 'buy_orbital_mines';
      DELETE FROM hardware_item WHERE name = 'orbital_mine';

      -- === Starbase Buy Qty ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='starbaseBuyQty'), (SELECT id FROM command WHERE name='enter_quantity'), '<number>', 'Enter quantity', NULL, NULL, 10),
        ((SELECT id FROM menu WHERE name='starbaseBuyQty'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', NULL, (SELECT id FROM menu WHERE name='starbaseHardware'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Shipyards ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='shipyards'), (SELECT id FROM command WHERE name='buy_ship'), 'b', 'Buy a new ship', NULL, (SELECT id FROM menu WHERE name='shipyardsBuy'), 10),
        ((SELECT id FROM menu WHERE name='shipyards'), (SELECT id FROM command WHERE name='examine_ships'), 'e', 'Examine ship specs', NULL, (SELECT id FROM menu WHERE name='shipyardsExamine'), 20),
        ((SELECT id FROM menu WHERE name='shipyards'), (SELECT id FROM command WHERE name='shipyards_equipment'), 'p', 'Purchase equipment', NULL, (SELECT id FROM menu WHERE name='shipyardsClass0'), 30),
        ((SELECT id FROM menu WHERE name='shipyards'), (SELECT id FROM command WHERE name='help_menu'), '?', 'Help', NULL, NULL, 35),
        ((SELECT id FROM menu WHERE name='shipyards'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', NULL, (SELECT id FROM menu WHERE name='starbase'), 40)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Shipyards Buy ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='shipyardsBuy'), (SELECT id FROM command WHERE name='view_detail'), '<letter>', 'Select ship', NULL, (SELECT id FROM menu WHERE name='shipyardsTradein'), 10),
        ((SELECT id FROM menu WHERE name='shipyardsBuy'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', NULL, (SELECT id FROM menu WHERE name='shipyards'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Shipyards Tradein ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='shipyardsTradein'), (SELECT id FROM command WHERE name='tradein_yes'), 'y', 'Trade in', 'shipExchangeTradein', NULL, 10),
        ((SELECT id FROM menu WHERE name='shipyardsTradein'), (SELECT id FROM command WHERE name='tradein_no'), 'n', 'Keep old ship', 'buyShipNew', NULL, 20),
        ((SELECT id FROM menu WHERE name='shipyardsTradein'), (SELECT id FROM command WHERE name='back'), 'q', 'Cancel', NULL, (SELECT id FROM menu WHERE name='shipyardsBuy'), 30)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Shipyards Examine ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='shipyardsExamine'), (SELECT id FROM command WHERE name='view_detail'), '<letter>', 'View ship detail', NULL, NULL, 10),
        ((SELECT id FROM menu WHERE name='shipyardsExamine'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', NULL, (SELECT id FROM menu WHERE name='shipyards'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Shipyards Class 0 ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='shipyardsClass0'), (SELECT id FROM command WHERE name='choose_holds'), 'a', 'Cargo holds', NULL, (SELECT id FROM menu WHERE name='shipyardsClass0Qty'), 10),
        ((SELECT id FROM menu WHERE name='shipyardsClass0'), (SELECT id FROM command WHERE name='choose_drones'), 'b', 'Drones', NULL, (SELECT id FROM menu WHERE name='shipyardsClass0Qty'), 20),
        ((SELECT id FROM menu WHERE name='shipyardsClass0'), (SELECT id FROM command WHERE name='choose_shields'), 'c', 'Shield Points', NULL, (SELECT id FROM menu WHERE name='shipyardsClass0Qty'), 30),
        ((SELECT id FROM menu WHERE name='shipyardsClass0'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', NULL, (SELECT id FROM menu WHERE name='shipyards'), 40),
        ((SELECT id FROM menu WHERE name='shipyardsClass0'), (SELECT id FROM command WHERE name='help_menu'), '?', 'Help', NULL, NULL, 50)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Shipyards Class 0 Qty ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='shipyardsClass0Qty'), (SELECT id FROM command WHERE name='enter_quantity'), '<number>', 'Enter quantity', NULL, NULL, 10),
        ((SELECT id FROM menu WHERE name='shipyardsClass0Qty'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', NULL, (SELECT id FROM menu WHERE name='shipyardsClass0'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Planet Select (after Land command) ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='planetSelect'), (SELECT id FROM command WHERE name='select_planet'), '<number>', 'Select planet', 'landOnPlanet', NULL, 10),
        ((SELECT id FROM menu WHERE name='planetSelect'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', NULL, (SELECT id FROM menu WHERE name='sector'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Planet (expand with new actions) ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='planet'), (SELECT id FROM command WHERE name='planet_display'), 'd', 'Planet Info', 'planetDisplay', NULL, 25),
        ((SELECT id FROM menu WHERE name='planet'), (SELECT id FROM command WHERE name='destroy_planet'), 'z', 'Destroy Planet', 'destroyPlanet', NULL, 35),
        ((SELECT id FROM menu WHERE name='planet'), (SELECT id FROM command WHERE name='leave_planet'), 'q', 'Leave Planet', 'leavePlanet', NULL, 40)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- Update destroy key from 'x' to 'z' (for existing DBs)
      UPDATE menu_command SET key_pattern = 'z' WHERE menu_id = (SELECT id FROM menu WHERE name='planet') AND command_id = (SELECT id FROM command WHERE name='destroy_planet');

      -- === Planet Earth (special sector 1 planet) ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='planetEarth'), (SELECT id FROM command WHERE name='take_colonists'), 't', 'Take colonists', NULL, (SELECT id FROM menu WHERE name='planetTakeQty'), 10),
        ((SELECT id FROM menu WHERE name='planetEarth'), (SELECT id FROM command WHERE name='leave_colonists'), 'l', 'Leave colonists', NULL, (SELECT id FROM menu WHERE name='planetLeaveQty'), 20),
        ((SELECT id FROM menu WHERE name='planetEarth'), (SELECT id FROM command WHERE name='leave_planet'), 'q', 'Leave Earth', 'leavePlanet', NULL, 30)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Planet Take Commodity ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='planetTakeCommodity'), (SELECT id FROM command WHERE name='choose_fuel'), 'f', 'Fuel', NULL, (SELECT id FROM menu WHERE name='planetTakeQty'), 10),
        ((SELECT id FROM menu WHERE name='planetTakeCommodity'), (SELECT id FROM command WHERE name='choose_organics'), 'o', 'Organics', NULL, (SELECT id FROM menu WHERE name='planetTakeQty'), 20),
        ((SELECT id FROM menu WHERE name='planetTakeCommodity'), (SELECT id FROM command WHERE name='choose_equipment'), 'e', 'Equipment', NULL, (SELECT id FROM menu WHERE name='planetTakeQty'), 30),
        ((SELECT id FROM menu WHERE name='planetTakeCommodity'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', NULL, (SELECT id FROM menu WHERE name='planet'), 40)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Planet Leave Commodity ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='planetLeaveCommodity'), (SELECT id FROM command WHERE name='choose_fuel'), 'f', 'Fuel', NULL, (SELECT id FROM menu WHERE name='planetLeaveQty'), 10),
        ((SELECT id FROM menu WHERE name='planetLeaveCommodity'), (SELECT id FROM command WHERE name='choose_organics'), 'o', 'Organics', NULL, (SELECT id FROM menu WHERE name='planetLeaveQty'), 20),
        ((SELECT id FROM menu WHERE name='planetLeaveCommodity'), (SELECT id FROM command WHERE name='choose_equipment'), 'e', 'Equipment', NULL, (SELECT id FROM menu WHERE name='planetLeaveQty'), 30),
        ((SELECT id FROM menu WHERE name='planetLeaveCommodity'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', NULL, (SELECT id FROM menu WHERE name='planet'), 40)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- Update planet 'back' to be 'leave_planet' instead (remove old back, add leave_planet as q)
      DELETE FROM menu_command WHERE menu_id = (SELECT id FROM menu WHERE name='planet') AND command_id = (SELECT id FROM command WHERE name='back');

      -- Sector 'd' is now Deploy drones (was 'f'); Display sector is Enter-only (not in registry)
      DELETE FROM menu_command WHERE menu_id = (SELECT id FROM menu WHERE name='sector') AND command_id = (SELECT id FROM command WHERE name='display_sector');
      UPDATE menu_command SET key_pattern = 'd', sort_order = 80 WHERE menu_id = (SELECT id FROM menu WHERE name='sector') AND command_id = (SELECT id FROM command WHERE name='deploy_drones_info');

      -- Sector 'q' now opens the quit confirm menu instead of closing immediately
      UPDATE menu_command SET client_msg_type = NULL, target_menu_id = (SELECT id FROM menu WHERE name='quitConfirm')
        WHERE menu_id = (SELECT id FROM menu WHERE name='sector') AND command_id = (SELECT id FROM command WHERE name='quit_game');

      -- Sector 'u' now sends a TerraformInfo lookup; server transitions to terraformConfirm
      UPDATE menu_command SET client_msg_type = 'terraformInfo', target_menu_id = NULL
        WHERE menu_id = (SELECT id FROM menu WHERE name='sector') AND command_id = (SELECT id FROM command WHERE name='use_terraform_device');

      -- Confirm-menu key bindings (y/n)
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='quitConfirm'),      (SELECT id FROM command WHERE name='confirm_yes'), 'y', 'Yes', NULL, NULL, 10),
        ((SELECT id FROM menu WHERE name='quitConfirm'),      (SELECT id FROM command WHERE name='confirm_no'),  'n', 'No',  NULL, (SELECT id FROM menu WHERE name='sector'), 20),
        ((SELECT id FROM menu WHERE name='terraformConfirm'), (SELECT id FROM command WHERE name='confirm_yes'), 'y', 'Yes', 'useTerraformDevice', NULL, 10),
        ((SELECT id FROM menu WHERE name='terraformConfirm'), (SELECT id FROM command WHERE name='confirm_no'),  'n', 'No',  NULL, (SELECT id FROM menu WHERE name='sector'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Sector: add terraform and list deployed drones ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='use_terraform_device'), 'u', 'Terraform', 'useTerraformDevice', NULL, 95),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='list_deployed_drones'), 'g', 'Deployed Drones', 'listDeployedDrones', NULL, 85)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Sector: mine deployment / listing / disruptor ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='deploy_mines_menu'), 'n', 'Deploy mines', NULL, (SELECT id FROM menu WHERE name='deployMines'), 86),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='list_deployed_mines'), 'e', 'Deployed Mines', 'listDeployedMines', NULL, 87),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='mine_disruptor_menu'), 'r', 'Mine Disruptor', NULL, (SELECT id FROM menu WHERE name='mineDisruptorTarget'), 88)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Deploy Mines (type picker) ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='deployMines'), (SELECT id FROM command WHERE name='deploy_proximity_mines'), 'p', 'Proximity Mines', NULL, (SELECT id FROM menu WHERE name='deployMinesQty'), 10),
        ((SELECT id FROM menu WHERE name='deployMines'), (SELECT id FROM command WHERE name='deploy_seeker_mines'), 's', 'Seeker Mines', NULL, (SELECT id FROM menu WHERE name='deployMinesQty'), 20),
        ((SELECT id FROM menu WHERE name='deployMines'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', NULL, (SELECT id FROM menu WHERE name='sector'), 30)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Deploy Mines Qty ===
      -- BANDAID: Q cancels all the way back to sector to match the client.
      -- Deploy success also routes to sector, so deployMines is unreachable
      -- from here in either branch. Refactor along with the wider menu cleanup.
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='deployMinesQty'), (SELECT id FROM command WHERE name='enter_quantity'), '<number>', 'Mines to deploy', 'deployMine', NULL, 10),
        ((SELECT id FROM menu WHERE name='deployMinesQty'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', NULL, (SELECT id FROM menu WHERE name='sector'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;
      UPDATE menu_command SET target_menu_id = (SELECT id FROM menu WHERE name='sector')
       WHERE menu_id = (SELECT id FROM menu WHERE name='deployMinesQty')
         AND command_id = (SELECT id FROM command WHERE name='back');

      -- === Mine Disruptor Target ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='mineDisruptorTarget'), (SELECT id FROM command WHERE name='enter_quantity'), '<number>', 'Adjacent target sector', 'mineDisruptor', NULL, 10),
        ((SELECT id FROM menu WHERE name='mineDisruptorTarget'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', NULL, (SELECT id FROM menu WHERE name='sector'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Computer: add hyperspace jump, deployed drones, list planets ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='computer'), (SELECT id FROM command WHERE name='list_deployed_drones'), 'd', 'Deployed Drones', 'listDeployedDrones', NULL, 55),
        ((SELECT id FROM menu WHERE name='computer'), (SELECT id FROM command WHERE name='hyperspace_jump'), 'h', 'Hyperspace Jump', NULL, (SELECT id FROM menu WHERE name='hyperspaceJumpTarget'), 56),
        ((SELECT id FROM menu WHERE name='computer'), (SELECT id FROM command WHERE name='list_planets'), 'y', 'Your Planets', 'listPlanets', NULL, 57),
        ((SELECT id FROM menu WHERE name='computer'), (SELECT id FROM command WHERE name='track_seeker_mines'), 'm', 'Track Seeker Mines', 'trackSeekerMines', NULL, 58)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Hyperspace Jump Target ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='hyperspaceJumpTarget'), (SELECT id FROM command WHERE name='enter_quantity'), '<number>', 'Target sector', 'hyperspaceJump', NULL, 10),
        ((SELECT id FROM menu WHERE name='hyperspaceJumpTarget'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', NULL, (SELECT id FROM menu WHERE name='computer'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Move (adjacent-sector picker) ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='move'), (SELECT id FROM command WHERE name='select_warp_1'), '1', 'Warp 1', NULL, NULL, 10),
        ((SELECT id FROM menu WHERE name='move'), (SELECT id FROM command WHERE name='select_warp_2'), '2', 'Warp 2', NULL, NULL, 20),
        ((SELECT id FROM menu WHERE name='move'), (SELECT id FROM command WHERE name='select_warp_3'), '3', 'Warp 3', NULL, NULL, 30),
        ((SELECT id FROM menu WHERE name='move'), (SELECT id FROM command WHERE name='select_warp_4'), '4', 'Warp 4', NULL, NULL, 40),
        ((SELECT id FROM menu WHERE name='move'), (SELECT id FROM command WHERE name='select_warp_5'), '5', 'Warp 5', NULL, NULL, 50),
        ((SELECT id FROM menu WHERE name='move'), (SELECT id FROM command WHERE name='select_warp_6'), '6', 'Warp 6', NULL, NULL, 60),
        ((SELECT id FROM menu WHERE name='move'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', NULL, (SELECT id FROM menu WHERE name='sector'), 70)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name='sector') WHERE name = 'move';

      -- === Seed hardware items ===
      INSERT INTO hardware_item (name, label, kind, default_price, result_msg_type, result_extra) VALUES
        ('planet_buster',    'Planet Busters',          'stackable', 40000,  'buyHardwareResult', NULL),
        ('terraform_device', 'Terraform Devices',       'stackable', 25000,  'buyHardwareResult', NULL),
        ('buoy',             'Space Buoys',             'stackable', 100,    'buyHardwareResult', NULL),
        ('proximity_mine',   'Proximity Mines',         'stackable', 500,    'buyHardwareResult', '{"mineType": "proximity"}'),
        ('seeker_mine',      'Seeker Mines',            'stackable', 9500,   'buyHardwareResult', '{"mineType": "seeker"}'),
        ('mine_disruptor',   'Mine Disruptors',         'stackable', 5000,   'buyHardwareResult', NULL),
        ('cloaking_device',  'Cloaking Devices',        'stackable', 25000,  'buyHardwareResult', NULL),
        ('corbomite',        'Corbomite',               'stackable', 500,    'buyHardwareResult', NULL),
        ('photon_torpedo',   'Photon Torpedoes',        'stackable', 60000,  'buyHardwareResult', NULL),
        ('recon_drone',      'Recon Drones',            'stackable', 1500,   'buyHardwareResult', NULL),
        ('visual_scanner',   'Visual Scanner',          'toggle',    50000,  'buyHardwareResult', NULL),
        ('planet_scanner',   'Planet Scanner',          'toggle',    20000,  'buyHardwareResult', NULL),
        ('hyperspace_1',     'Hyperspace Type 1', 'toggle',    100000, 'buyHardwareResult', '{"driveType": 1}'),
        ('hyperspace_2',     'Hyperspace Type 2', 'toggle',    150000, 'buyHardwareResult', '{"driveType": 2}')
      ON CONFLICT (name) DO UPDATE SET
        label = EXCLUDED.label,
        kind = EXCLUDED.kind,
        default_price = EXCLUDED.default_price,
        result_msg_type = EXCLUDED.result_msg_type,
        result_extra = EXCLUDED.result_extra;

      -- Seed the 'stock' template. Values that overlap with universeConfig
      -- are pushed via a parameterised UPDATE just below — universeConfig is
      -- the single source of truth for those defaults.
      INSERT INTO edit_templates (name) VALUES ('stock') ON CONFLICT (name) DO NOTHING;
    `);

        // Sync 'stock' template fields with universeConfig (single source of
        // truth for the values that overlap with template columns). Runs
        // every boot so config changes propagate to NEW universes without
        // manual SQL — existing universes have their own universe_settings
        // row and are unaffected.
        await client.query(
            `UPDATE edit_templates
             SET starting_credits = $1,
                 starting_drones = $2,
                 starting_shields = $3,
                 starting_ship = $4,
                 starting_turns = $5,
                 turns_per_day = $6,
                 turn_delay = $7,
                 max_planets_per_sector = $8,
                 planet_collision_likelihood = $9,
                 planet_collision_min_hours = $10,
                 planet_collision_max_hours = $11
             WHERE name = 'stock'`,
            [
                universeConfig.startingCredits,
                universeConfig.startingDrones,
                universeConfig.startingShields,
                universeConfig.startingShip,
                universeConfig.startingTurns,
                universeConfig.turnsPerDay,
                universeConfig.turnDelay,
                universeConfig.maxPlanetsPerSector,
                universeConfig.planetCollisionLikelihood,
                universeConfig.planetCollisionMinHours,
                universeConfig.planetCollisionMaxHours,
            ],
        );

        // One-time migration v1: split the legacy `edits` table into
        // edit_templates + universe_settings, then drop the old table and
        // its FK column on universes.
        const v1 = await client.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count FROM _schema_version WHERE version = 1`,
        );
        const oldEditsExists = await client.query<{ exists: boolean }>(
            `SELECT EXISTS (
                SELECT FROM information_schema.tables WHERE table_name = 'edits'
             ) AS exists`,
        );
        if (v1.rows[0].count === 0 && oldEditsExists.rows[0].exists) {
            // 1. Move named templates from edits → edit_templates.
            await client.query(`
                INSERT INTO edit_templates (
                    id, name, max_planets_per_sector, planet_collision_likelihood,
                    planet_collision_min_hours, planet_collision_max_hours,
                    turns_per_day, starting_turns, max_turns, starting_ship,
                    starting_drones, starting_credits, starting_port_density,
                    max_port_density, port_production_rate, port_memory_hours,
                    max_players, max_age_days, max_planets, turn_delay,
                    is_speed_warp_delay_on, photons_allowed,
                    photon_blast_time_seconds, planet_spawn_density,
                    max_ships_allowed, max_corp_size,
                    max_ships_in_protected_space, truce_time_hours,
                    is_automation_enabled, starting_shields,
                    starting_earth_colonists
                )
                SELECT id, name, max_planets_per_sector, planet_collision_likelihood,
                       planet_collision_min_hours, planet_collision_max_hours,
                       turns_per_day, starting_turns, max_turns, starting_ship,
                       starting_drones, starting_credits, starting_port_density,
                       max_port_density, port_production_rate, port_memory_hours,
                       max_players, max_age_days, max_planets, turn_delay,
                       is_speed_warp_delay_on, photons_allowed,
                       photon_blast_time_seconds, planet_spawn_density,
                       max_ships_allowed, max_corp_size,
                       max_ships_in_protected_space, truce_time_hours,
                       is_automation_enabled,
                       COALESCE(starting_shields, 0),
                       COALESCE(starting_earth_colonists, 1000000)
                FROM edits
                WHERE name IS NOT NULL
                ON CONFLICT (id) DO NOTHING;

                -- Sync the SERIAL counter so future inserts don't collide.
                SELECT setval(pg_get_serial_sequence('edit_templates', 'id'),
                              COALESCE((SELECT MAX(id) FROM edit_templates), 1));
            `);
            // 2. For each universe, copy column values from its old edits
            //    row into universe_settings. Works whether the old row was
            //    a named template or a NULL-named snapshot — either way we
            //    capture the values that universe was actually using.
            await client.query(`
                INSERT INTO universe_settings (
                    universe_id, max_planets_per_sector, planet_collision_likelihood,
                    planet_collision_min_hours, planet_collision_max_hours,
                    turns_per_day, starting_turns, max_turns, starting_ship,
                    starting_drones, starting_credits, starting_port_density,
                    max_port_density, port_production_rate, port_memory_hours,
                    max_players, max_age_days, max_planets, turn_delay,
                    is_speed_warp_delay_on, photons_allowed,
                    photon_blast_time_seconds, planet_spawn_density,
                    max_ships_allowed, max_corp_size,
                    max_ships_in_protected_space, truce_time_hours,
                    is_automation_enabled, starting_shields,
                    starting_earth_colonists
                )
                SELECT u.id, e.max_planets_per_sector, e.planet_collision_likelihood,
                       e.planet_collision_min_hours, e.planet_collision_max_hours,
                       e.turns_per_day, e.starting_turns, e.max_turns, e.starting_ship,
                       e.starting_drones, e.starting_credits, e.starting_port_density,
                       e.max_port_density, e.port_production_rate, e.port_memory_hours,
                       e.max_players, e.max_age_days, e.max_planets, e.turn_delay,
                       e.is_speed_warp_delay_on, e.photons_allowed,
                       e.photon_blast_time_seconds, e.planet_spawn_density,
                       e.max_ships_allowed, e.max_corp_size,
                       e.max_ships_in_protected_space, e.truce_time_hours,
                       e.is_automation_enabled,
                       COALESCE(e.starting_shields, 0),
                       COALESCE(e.starting_earth_colonists, 1000000)
                FROM universes u
                JOIN edits e ON u.edit_id = e.id
                ON CONFLICT (universe_id) DO NOTHING;
            `);
            // 3. Add universes.template_id and populate it. NULL-named
            //    snapshots came from 'stock' (only template that ever
            //    existed); named rows map to their own edit_templates entry.
            await client.query(`
                ALTER TABLE universes ADD COLUMN IF NOT EXISTS template_id
                    INTEGER REFERENCES edit_templates(id) ON DELETE SET NULL;

                UPDATE universes u
                SET template_id = COALESCE(
                    (SELECT et.id FROM edits e
                     JOIN edit_templates et ON et.name = e.name
                     WHERE e.id = u.edit_id),
                    (SELECT id FROM edit_templates WHERE name = 'stock')
                )
                WHERE u.template_id IS NULL AND u.edit_id IS NOT NULL;
            `);
            // 4. Migrate junction tables (hardware_price, ship_types_edits,
            //    planet_types_edits) from edit_id → template_id. They only
            //    ever pointed at named templates so the mapping is direct.
            await client.query(`
                ALTER TABLE hardware_price ADD COLUMN IF NOT EXISTS template_id
                    INTEGER REFERENCES edit_templates(id) ON DELETE CASCADE;
                UPDATE hardware_price hp
                SET template_id = (SELECT et.id FROM edits e
                                   JOIN edit_templates et ON et.name = e.name
                                   WHERE e.id = hp.edit_id)
                WHERE hp.template_id IS NULL;
                ALTER TABLE hardware_price DROP CONSTRAINT IF EXISTS hardware_price_pkey;
                ALTER TABLE hardware_price DROP COLUMN IF EXISTS edit_id;
                ALTER TABLE hardware_price ADD PRIMARY KEY (template_id, hardware_item_id);

                ALTER TABLE ship_types_edits ADD COLUMN IF NOT EXISTS template_id
                    INTEGER REFERENCES edit_templates(id) ON DELETE CASCADE;
                UPDATE ship_types_edits ste
                SET template_id = (SELECT et.id FROM edits e
                                   JOIN edit_templates et ON et.name = e.name
                                   WHERE e.id = ste.edit_id)
                WHERE ste.template_id IS NULL;
                ALTER TABLE ship_types_edits DROP CONSTRAINT IF EXISTS ship_types_edits_pkey;
                ALTER TABLE ship_types_edits DROP COLUMN IF EXISTS edit_id;
                ALTER TABLE ship_types_edits ADD PRIMARY KEY (ship_type_id, template_id);

                ALTER TABLE planet_types_edits ADD COLUMN IF NOT EXISTS template_id
                    INTEGER REFERENCES edit_templates(id) ON DELETE CASCADE;
                UPDATE planet_types_edits pte
                SET template_id = (SELECT et.id FROM edits e
                                   JOIN edit_templates et ON et.name = e.name
                                   WHERE e.id = pte.edit_id)
                WHERE pte.template_id IS NULL;
                ALTER TABLE planet_types_edits DROP CONSTRAINT IF EXISTS planet_types_edits_pkey;
                ALTER TABLE planet_types_edits DROP COLUMN IF EXISTS edit_id;
                ALTER TABLE planet_types_edits ADD PRIMARY KEY (planet_type, template_id);
            `);
            // 5. Drop the legacy table and the universes.edit_id column.
            await client.query(`
                ALTER TABLE universes DROP COLUMN IF EXISTS edit_id;
                DROP TABLE IF EXISTS edits CASCADE;
            `);
            await client.query(`INSERT INTO _schema_version (version) VALUES (1)`);
        } else if (v1.rows[0].count === 0) {
            // Fresh install: no legacy table, just record the version.
            await client.query(`INSERT INTO _schema_version (version) VALUES (1)`);
        }

        // Seed ship_types from config files (idempotent)
        // Hardware config field -> hardware_item name mapping
        const HW_CONFIG_MAP: Record<string, { configKey: string; isToggle?: boolean }> = {
            planet_buster: { configKey: 'maxPlanetBusters' },
            terraform_device: { configKey: 'maxTerraformDevices' },
            buoy: { configKey: 'maxBuoy' },
            proximity_mine: { configKey: 'maxProximity' },
            seeker_mine: { configKey: 'maxSeeker' },
            mine_disruptor: { configKey: 'maxDisruptors' },
            cloaking_device: { configKey: 'maxCloaking' },
            corbomite: { configKey: 'maxCorbomite' },
            photon_torpedo: { configKey: 'maxPhoton' },
            recon_drone: { configKey: 'maxReconDrones' },
            visual_scanner: { configKey: 'canHaveVisualScanner', isToggle: true },
            planet_scanner: { configKey: 'canHavePlanetScanner', isToggle: true },
            hyperspace_1: { configKey: 'canHaveHyperspace1', isToggle: true },
            hyperspace_2: { configKey: 'canHaveHyperspace2', isToggle: true },
        };

        for (const ship of Object.values(shipConfigs)) {
            const stRes = await client.query(
                `INSERT INTO ship_types (
                    name, display_name, make, sort_order,
                    max_drones, max_shields, starting_holds, max_holds,
                    odds_offensive, odds_defensive,
                    has_pod, can_land, has_interdictor,
                    has_planetary_defense_bonus, planetary_defense_odds,
                    speed, turns_per_warp,
                    cost_drive, cost_computer, cost_hull, hold_cost,
                    max_drone_attack, transporter_range,
                    has_tractor,
                    piloting_restriction, notes
                 ) VALUES (
                    $1, $2, $3, $4,
                    $5, $6, $7, $8,
                    $9, $10,
                    $11, $12, $13,
                    $14, $15,
                    $16, $17,
                    $18, $19, $20, $21,
                    $22, $23,
                    $24,
                    $25, $26
                 ) ON CONFLICT (name) DO UPDATE SET
                    display_name = EXCLUDED.display_name,
                    make = EXCLUDED.make,
                    sort_order = EXCLUDED.sort_order,
                    max_drones = EXCLUDED.max_drones,
                    max_shields = EXCLUDED.max_shields,
                    starting_holds = EXCLUDED.starting_holds,
                    max_holds = EXCLUDED.max_holds,
                    odds_offensive = EXCLUDED.odds_offensive,
                    odds_defensive = EXCLUDED.odds_defensive,
                    has_pod = EXCLUDED.has_pod,
                    can_land = EXCLUDED.can_land,
                    has_interdictor = EXCLUDED.has_interdictor,
                    has_planetary_defense_bonus = EXCLUDED.has_planetary_defense_bonus,
                    planetary_defense_odds = EXCLUDED.planetary_defense_odds,
                    speed = EXCLUDED.speed,
                    turns_per_warp = EXCLUDED.turns_per_warp,
                    cost_drive = EXCLUDED.cost_drive,
                    cost_computer = EXCLUDED.cost_computer,
                    cost_hull = EXCLUDED.cost_hull,
                    hold_cost = EXCLUDED.hold_cost,
                    max_drone_attack = EXCLUDED.max_drone_attack,
                    transporter_range = EXCLUDED.transporter_range,
                    has_tractor = EXCLUDED.has_tractor,
                    piloting_restriction = EXCLUDED.piloting_restriction,
                    notes = EXCLUDED.notes
                 RETURNING id`,
                [
                    ship.name,
                    ship.displayName ?? null,
                    ship.make || null,
                    ship.sortOrder ?? 0,
                    ship.maxDrones ?? 0,
                    ship.maxShields ?? 0,
                    ship.startingHolds ?? 5,
                    ship.maxHolds ?? 20,
                    ship.oddsOffensive ?? 1.0,
                    ship.oddsDefensive ?? 1.0,
                    ship.hasPod ?? true,
                    ship.canLand ?? true,
                    ship.hasInterdictor ?? false,
                    ship.hasPlanetaryDefenseBonus ?? false,
                    ship.planetaryDefenseOdds ?? null,
                    ship.speed ?? 10,
                    ship.turnsPerWarp ?? 2,
                    ship.costDrive ?? 0,
                    ship.costComputer ?? 0,
                    ship.costHull ?? 0,
                    ship.holdCost ?? 0,
                    ship.maxDroneAttack ?? 0,
                    ship.transporterRange ?? 0,
                    ship.hasTractor ?? false,
                    ship.pilotingRestriction ?? null,
                    ship.notes ?? null,
                ],
            );
            const shipTypeId = stRes.rows[0].id;

            // Seed ship_type_hardware from config
            for (const [hwName, mapping] of Object.entries(HW_CONFIG_MAP)) {
                const val = ship[mapping.configKey as keyof ShipConfig] as
                    | number
                    | boolean
                    | undefined;
                const maxQty = mapping.isToggle ? (val ? 1 : 0) : ((val as number) ?? 0);
                if (maxQty > 0) {
                    await client.query(
                        `INSERT INTO ship_type_hardware (ship_type_id, hardware_item_id, max_quantity)
                         VALUES ($1, (SELECT id FROM hardware_item WHERE name = $2), $3)
                         ON CONFLICT (ship_type_id, hardware_item_id) DO UPDATE SET max_quantity = EXCLUDED.max_quantity`,
                        [shipTypeId, hwName, maxQty],
                    );
                }
            }
        }

        // Seed hardware_price: default prices for the 'stock' template.
        await client.query(`
            INSERT INTO hardware_price (template_id, hardware_item_id, price)
            SELECT et.id, hi.id, hi.default_price
            FROM edit_templates et, hardware_item hi
            WHERE et.name = 'stock'
            ON CONFLICT (template_id, hardware_item_id) DO UPDATE SET price = EXCLUDED.price
        `);

        // Seed planet_types from config files (idempotent)
        for (const planet of Object.values(planetConfigs)) {
            await client.query(
                `INSERT INTO planet_types (name, description, max_colonists, max_citadel, fuel_production, organics_production, equipment_production)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (name) DO UPDATE SET
                    description = EXCLUDED.description,
                    max_colonists = EXCLUDED.max_colonists,
                    max_citadel = EXCLUDED.max_citadel,
                    fuel_production = EXCLUDED.fuel_production,
                    organics_production = EXCLUDED.organics_production,
                    equipment_production = EXCLUDED.equipment_production`,
                [
                    planet.type,
                    planet.description ?? null,
                    planet.maxColonists ?? 0,
                    planet.maxCitadel ?? 0,
                    planet.fuelProduction ?? 0,
                    planet.organicsProduction ?? 0,
                    planet.equipmentProduction ?? 0,
                ],
            );
        }

        // Seed ship_types_edits: link all ship types to the 'stock' template.
        await client.query(`
            INSERT INTO ship_types_edits (ship_type_id, template_id)
            SELECT st.id, et.id FROM ship_types st, edit_templates et WHERE et.name = 'stock'
            ON CONFLICT DO NOTHING
        `);

        // Seed planet_types_edits: link all planet types to the 'stock' template.
        await client.query(`
            INSERT INTO planet_types_edits (planet_type, template_id)
            SELECT DISTINCT p.type, et.id FROM planets p, edit_templates et WHERE et.name = 'stock'
            ON CONFLICT DO NOTHING
        `);

        // Also seed default planet types even if no planets exist yet.
        await client.query(`
            INSERT INTO planet_types_edits (planet_type, template_id)
            VALUES
                ('Terran', (SELECT id FROM edit_templates WHERE name = 'stock')),
                ('Agricultural', (SELECT id FROM edit_templates WHERE name = 'stock')),
                ('Barren', (SELECT id FROM edit_templates WHERE name = 'stock')),
                ('Crystalline', (SELECT id FROM edit_templates WHERE name = 'stock')),
                ('Desert', (SELECT id FROM edit_templates WHERE name = 'stock')),
                ('Gas Giant', (SELECT id FROM edit_templates WHERE name = 'stock')),
                ('Glacial', (SELECT id FROM edit_templates WHERE name = 'stock')),
                ('Jungle', (SELECT id FROM edit_templates WHERE name = 'stock')),
                ('Mountainous', (SELECT id FROM edit_templates WHERE name = 'stock')),
                ('Oceanic', (SELECT id FROM edit_templates WHERE name = 'stock')),
                ('Toxic', (SELECT id FROM edit_templates WHERE name = 'stock')),
                ('Volcanic', (SELECT id FROM edit_templates WHERE name = 'stock'))
            ON CONFLICT DO NOTHING
        `);

        // Clean up orphaned rows before adding FK constraints
        await client.query(`
            DELETE FROM planet_types_edits WHERE planet_type NOT IN (SELECT name FROM planet_types);
            UPDATE planets SET type = 'Terran' WHERE type NOT IN (SELECT name FROM planet_types);
        `);

        // Add FK constraints that depend on seeded data
        await client.query(`
            -- FK from planet_types_edits.planet_type to planet_types.name
            DO $$ BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'planet_types_edits_planet_type_fkey'
                  AND table_name = 'planet_types_edits'
              ) THEN
                ALTER TABLE planet_types_edits ADD CONSTRAINT planet_types_edits_planet_type_fkey
                  FOREIGN KEY (planet_type) REFERENCES planet_types(name) ON DELETE CASCADE;
              END IF;
            END $$;

            -- FK from planets.type to planet_types.name
            DO $$ BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'planets_type_fkey'
                  AND table_name = 'planets'
              ) THEN
                ALTER TABLE planets ADD CONSTRAINT planets_type_fkey
                  FOREIGN KEY (type) REFERENCES planet_types(name);
              END IF;
            END $$;
        `);

        client.release();
        isConnected = true;
        console.log('PostgreSQL connected and schema verified');
    } catch (error) {
        console.error('PostgreSQL connection error:', error);
        throw error;
    }
};
