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
        max_clan_size SMALLINT NOT NULL DEFAULT 4,
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
        mine_disruptor_max SMALLINT NOT NULL DEFAULT ${universeConfig.mineDisruptorMax},
        respawn_delay_seconds INTEGER NOT NULL DEFAULT ${universeConfig.respawnDelaySeconds},
        colos_to_produce_one_unit_per_hour INTEGER NOT NULL DEFAULT ${universeConfig.colosToProduceOneUnitPerHour},
        daily_reproduction_per_1000_colos INTEGER NOT NULL DEFAULT ${universeConfig.dailyReproductionPer1000Colos}
      );

      CREATE TABLE IF NOT EXISTS universes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        seed INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        template_id INTEGER REFERENCES edit_templates(id) ON DELETE SET NULL,
        topology VARCHAR(16) NOT NULL DEFAULT 'random'
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
        max_clan_size SMALLINT NOT NULL,
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
        mine_disruptor_max SMALLINT NOT NULL DEFAULT ${universeConfig.mineDisruptorMax},
        respawn_delay_seconds INTEGER NOT NULL DEFAULT ${universeConfig.respawnDelaySeconds},
        colos_to_produce_one_unit_per_hour INTEGER NOT NULL DEFAULT ${universeConfig.colosToProduceOneUnitPerHour},
        daily_reproduction_per_1000_colos INTEGER NOT NULL DEFAULT ${universeConfig.dailyReproductionPer1000Colos}
      );

      CREATE TABLE IF NOT EXISTS sectors (
        id SERIAL PRIMARY KEY,
        universe_id INTEGER NOT NULL REFERENCES universes(id) ON DELETE CASCADE,
        sector_number INTEGER NOT NULL,
        name VARCHAR(255),
        is_protected BOOLEAN NOT NULL DEFAULT FALSE,
        x DOUBLE PRECISION,
        y DOUBLE PRECISION,
        UNIQUE (universe_id, sector_number)
      );

      CREATE TABLE IF NOT EXISTS warps (
        from_sector_id INTEGER NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
        to_sector_id INTEGER NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
        PRIMARY KEY (from_sector_id, to_sector_id),
        CONSTRAINT warps_no_self_loop CHECK (from_sector_id <> to_sector_id)
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
        notes TEXT,
        basic_hold_cost INTEGER GENERATED ALWAYS AS (starting_holds * hold_cost) STORED,
        base_cost INTEGER GENERATED ALWAYS AS (cost_drive + cost_computer + cost_hull + starting_holds * hold_cost) STORED
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

      CREATE TABLE IF NOT EXISTS planet_types (
        name VARCHAR(255) PRIMARY KEY,
        display_name VARCHAR(512),
        description TEXT,
        max_fuel_colos INTEGER NOT NULL DEFAULT 0,
        max_org_colos INTEGER NOT NULL DEFAULT 0,
        max_equ_colos INTEGER NOT NULL DEFAULT 0,
        max_drone_colos INTEGER NOT NULL DEFAULT 0,
        max_fuel INTEGER NOT NULL DEFAULT 0,
        max_org INTEGER NOT NULL DEFAULT 0,
        max_equ INTEGER NOT NULL DEFAULT 0,
        max_drones INTEGER NOT NULL DEFAULT 0,
        max_citadel SMALLINT NOT NULL DEFAULT 0,
        fuel_production SMALLINT NOT NULL DEFAULT 0,
        organics_production SMALLINT NOT NULL DEFAULT 0,
        equipment_production SMALLINT NOT NULL DEFAULT 0,
        drone_production SMALLINT NOT NULL DEFAULT 0,
        danger SMALLINT NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS planet_types_edits (
        planet_type VARCHAR(255) NOT NULL REFERENCES planet_types(name) ON DELETE CASCADE,
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
        clan_id INTEGER,
        credits INTEGER NOT NULL DEFAULT 10000,
        reputation INTEGER NOT NULL DEFAULT 0,
        experience INTEGER NOT NULL DEFAULT 0,
        ship_destroyed_date TIMESTAMPTZ,
        towed_ship_id INTEGER,
        last_login_at TIMESTAMPTZ,
        last_logout_at TIMESTAMPTZ,
        docked BOOLEAN NOT NULL DEFAULT FALSE,
        on_planet_id INTEGER DEFAULT NULL,
        turns INTEGER NOT NULL DEFAULT 0,
        last_turns_granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        is_knighted BOOLEAN NOT NULL DEFAULT FALSE,
        UNIQUE (user_id, universe_id)
      );

      CREATE TABLE IF NOT EXISTS clans (
        id SERIAL PRIMARY KEY,
        universe_clan_number INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        leader_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        universe_id INTEGER NOT NULL REFERENCES universes(id) ON DELETE CASCADE,
        UNIQUE (name, universe_id),
        UNIQUE (universe_id, universe_clan_number)
      );

      CREATE TABLE IF NOT EXISTS ships (
        id SERIAL PRIMARY KEY,
        universe_id INTEGER NOT NULL REFERENCES universes(id) ON DELETE CASCADE,
        universe_ship_number INTEGER NOT NULL,
        name TEXT NOT NULL,
        owner_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
        owner_clan_id INTEGER REFERENCES clans(id) ON DELETE SET NULL,
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
        colonists INTEGER NOT NULL DEFAULT 0,
        UNIQUE (universe_id, universe_ship_number),
        CONSTRAINT ships_single_owner_type
          CHECK (NOT (owner_player_id IS NOT NULL AND owner_clan_id IS NOT NULL))
      );

      CREATE TABLE IF NOT EXISTS ship_hardware (
        ship_id INTEGER NOT NULL REFERENCES ships(id) ON DELETE CASCADE,
        hardware_item_id INTEGER NOT NULL REFERENCES hardware_item(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (ship_id, hardware_item_id)
      );

      -- Circular FKs from players that can't be inlined: players.ship_id
      -- depends on ships (which already references players.id via
      -- owner_player_id), and players.clan_id depends on clans (which
      -- references players.id via leader_id).
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'players_ship_id_fkey' AND table_name = 'players'
        ) THEN
          ALTER TABLE players ADD CONSTRAINT players_ship_id_fkey
            FOREIGN KEY (ship_id) REFERENCES ships(id) ON DELETE SET NULL;
        END IF;
      END $$;
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'players_clan_id_fkey' AND table_name = 'players'
        ) THEN
          ALTER TABLE players ADD CONSTRAINT players_clan_id_fkey
            FOREIGN KEY (clan_id) REFERENCES clans(id) ON DELETE SET NULL;
        END IF;
      END $$;
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'players_towed_ship_id_fkey' AND table_name = 'players'
        ) THEN
          ALTER TABLE players ADD CONSTRAINT players_towed_ship_id_fkey
            FOREIGN KEY (towed_ship_id) REFERENCES ships(id) ON DELETE SET NULL;
        END IF;
      END $$;

      CREATE TABLE IF NOT EXISTS ports (
        id SERIAL PRIMARY KEY,
        sector_id INTEGER NOT NULL UNIQUE REFERENCES sectors(id) ON DELETE CASCADE,
        class INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        fuel INTEGER NOT NULL DEFAULT 1000,
        fuel_max INTEGER NOT NULL DEFAULT 1000,
        fuel_price INTEGER NOT NULL,
        fuel_buys BOOLEAN NOT NULL DEFAULT TRUE,
        organics INTEGER NOT NULL DEFAULT 1000,
        org_max INTEGER NOT NULL DEFAULT 1000,
        org_price INTEGER NOT NULL,
        org_buys BOOLEAN NOT NULL DEFAULT TRUE,
        equipment INTEGER NOT NULL DEFAULT 1000,
        equ_max INTEGER NOT NULL DEFAULT 1000,
        equ_price INTEGER NOT NULL,
        equ_buys BOOLEAN NOT NULL DEFAULT TRUE
      );

      CREATE TABLE IF NOT EXISTS planets (
        id SERIAL PRIMARY KEY,
        sector_id INTEGER NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(255) NOT NULL DEFAULT 'Terran' REFERENCES planet_types(name),
        drones INTEGER NOT NULL DEFAULT 0,
        shields INTEGER NOT NULL DEFAULT 0,
        has_base BOOLEAN NOT NULL DEFAULT FALSE,
        owner_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
        owner_clan_id INTEGER REFERENCES clans(id) ON DELETE SET NULL,
        fuel INTEGER NOT NULL DEFAULT 0,
        organics INTEGER NOT NULL DEFAULT 0,
        equipment INTEGER NOT NULL DEFAULT 0,
        colonists_fuel INTEGER NOT NULL DEFAULT 0,
        colonists_organics INTEGER NOT NULL DEFAULT 0,
        colonists_equipment INTEGER NOT NULL DEFAULT 0,
        colonists_drones INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ,
        last_production_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_colonist_event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        fuel_production_accrual DOUBLE PRECISION NOT NULL DEFAULT 0,
        org_production_accrual DOUBLE PRECISION NOT NULL DEFAULT 0,
        equ_production_accrual DOUBLE PRECISION NOT NULL DEFAULT 0,
        drn_production_accrual DOUBLE PRECISION NOT NULL DEFAULT 0,
        fuel_birth_accrual DOUBLE PRECISION NOT NULL DEFAULT 0,
        org_birth_accrual DOUBLE PRECISION NOT NULL DEFAULT 0,
        equ_birth_accrual DOUBLE PRECISION NOT NULL DEFAULT 0,
        drn_birth_accrual DOUBLE PRECISION NOT NULL DEFAULT 0,
        fuel_death_accrual DOUBLE PRECISION NOT NULL DEFAULT 0,
        org_death_accrual DOUBLE PRECISION NOT NULL DEFAULT 0,
        equ_death_accrual DOUBLE PRECISION NOT NULL DEFAULT 0,
        drn_death_accrual DOUBLE PRECISION NOT NULL DEFAULT 0,
        CONSTRAINT planets_single_owner_type
          CHECK (NOT (owner_player_id IS NOT NULL AND owner_clan_id IS NOT NULL))
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
        visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        snapshot JSONB,
        PRIMARY KEY (player_id, sector_id)
      );

      CREATE TABLE IF NOT EXISTS sector_drones (
        sector_id INTEGER NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
        owner_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
        owner_clan_id INTEGER REFERENCES clans(id) ON DELETE SET NULL,
        quantity INTEGER NOT NULL,
        PRIMARY KEY (sector_id),
        CONSTRAINT sector_drones_single_owner_type
          CHECK (NOT (owner_player_id IS NOT NULL AND owner_clan_id IS NOT NULL))
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

      CREATE TABLE IF NOT EXISTS audit_log (
        id           SERIAL PRIMARY KEY,
        player_id    INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        action_type  TEXT NOT NULL,
        delta        INTEGER NOT NULL,
        prev_credits INTEGER NOT NULL,
        new_credits  INTEGER NOT NULL,
        context      JSONB,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        hmac         TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_log_player
        ON audit_log (player_id, id);

      CREATE TABLE IF NOT EXISTS sector_mines (
        sector_id INTEGER NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
        mine_type VARCHAR(20) NOT NULL CHECK (mine_type IN ('proximity', 'seeker')),
        quantity INTEGER NOT NULL DEFAULT 0,
        owner_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
        owner_clan_id INTEGER REFERENCES clans(id) ON DELETE SET NULL,
        PRIMARY KEY (sector_id, mine_type),
        CHECK (NOT (owner_player_id IS NOT NULL AND owner_clan_id IS NOT NULL))
      );

      -- One row per ship that currently has a seeker mine attached. The
      -- owner columns identify the deployer (personal OR clan, same XOR
      -- pattern as sector_mines / sector_drones) so the tracker query can
      -- show clan members the attachments their clan deployed. At most
      -- one attachment per ship; new attachments dislodge the previous
      -- mine entirely.
      CREATE TABLE IF NOT EXISTS seeker_attachments (
        ship_id INTEGER PRIMARY KEY REFERENCES ships(id) ON DELETE CASCADE,
        owner_player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
        owner_clan_id INTEGER REFERENCES clans(id) ON DELETE CASCADE,
        attached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (NOT (owner_player_id IS NOT NULL AND owner_clan_id IS NOT NULL)),
        CHECK (owner_player_id IS NOT NULL OR owner_clan_id IS NOT NULL)
      );
      CREATE INDEX IF NOT EXISTS idx_seeker_attachments_owner_player
        ON seeker_attachments (owner_player_id);
      CREATE INDEX IF NOT EXISTS idx_seeker_attachments_owner_clan
        ON seeker_attachments (owner_clan_id);

      CREATE TABLE IF NOT EXISTS sector_beacons (
        sector_id INTEGER PRIMARY KEY REFERENCES sectors(id) ON DELETE CASCADE,
        owner_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
        owner_clan_id INTEGER REFERENCES clans(id) ON DELETE SET NULL,
        message VARCHAR(41) NOT NULL,
        deployed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (NOT (owner_player_id IS NOT NULL AND owner_clan_id IS NOT NULL))
      );

      CREATE TABLE IF NOT EXISTS visited_ports (
        player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        port_id INTEGER NOT NULL REFERENCES ports(id) ON DELETE CASCADE,
        visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        snapshot JSONB,
        PRIMARY KEY (player_id, port_id)
      );

      -- Clan memos + automatic transfer notifications. recipient_player_id
      -- always set; sender_player_id null for system-generated memos.
      -- Unread messages (read_at IS NULL) are delivered to the recipient on
      -- WS connect and immediately marked read.
      CREATE TABLE IF NOT EXISTS messages (
        id BIGSERIAL PRIMARY KEY,
        recipient_player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        sender_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
        clan_id INTEGER REFERENCES clans(id) ON DELETE SET NULL,
        kind VARCHAR(30) NOT NULL,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        read_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_messages_recipient_unread
        ON messages (recipient_player_id) WHERE read_at IS NULL;

      CREATE TABLE IF NOT EXISTS news (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        universe_id INTEGER NOT NULL REFERENCES universes(id) ON DELETE CASCADE,
        text TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_news_universe ON news (universe_id, created_at);

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
      -- === Seed hardware items ===
      INSERT INTO hardware_item (name, label, kind, default_price, result_msg_type, result_extra) VALUES
        ('planet_buster',    'Planet Busters',          'stackable', 40000,  'buyHardwareResult', NULL),
        ('terraform_device', 'Terraform Devices',       'stackable', 25000,  'buyHardwareResult', NULL),
        ('buoy',             'Marker Beacons',          'stackable', 250,    'buyHardwareResult', NULL),
        ('proximity_mine',   'Proximity Mines',         'stackable', 500,    'buyHardwareResult', '{"mineType": "proximity"}'),
        ('seeker_mine',      'Limpet Mines',            'stackable', 9500,   'buyHardwareResult', '{"mineType": "seeker"}'),
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
        // truth for the values that overlap with template columns).
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
                 planet_collision_max_hours = $11,
                 respawn_delay_seconds = $12,
                 colos_to_produce_one_unit_per_hour = $13,
                 daily_reproduction_per_1000_colos = $14
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
                universeConfig.respawnDelaySeconds,
                universeConfig.colosToProduceOneUnitPerHour,
                universeConfig.dailyReproductionPer1000Colos,
            ],
        );

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
                `INSERT INTO planet_types (name, display_name, description, max_fuel_colos, max_org_colos, max_equ_colos, max_drone_colos, max_fuel, max_org, max_equ, max_drones, max_citadel, fuel_production, organics_production, equipment_production, drone_production, danger)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                 ON CONFLICT (name) DO UPDATE SET
                    display_name = EXCLUDED.display_name,
                    description = EXCLUDED.description,
                    max_fuel_colos = EXCLUDED.max_fuel_colos,
                    max_org_colos = EXCLUDED.max_org_colos,
                    max_equ_colos = EXCLUDED.max_equ_colos,
                    max_drone_colos = EXCLUDED.max_drone_colos,
                    max_fuel = EXCLUDED.max_fuel,
                    max_org = EXCLUDED.max_org,
                    max_equ = EXCLUDED.max_equ,
                    max_drones = EXCLUDED.max_drones,
                    max_citadel = EXCLUDED.max_citadel,
                    fuel_production = EXCLUDED.fuel_production,
                    organics_production = EXCLUDED.organics_production,
                    equipment_production = EXCLUDED.equipment_production,
                    drone_production = EXCLUDED.drone_production,
                    danger = EXCLUDED.danger`,
                [
                    planet.type,
                    planet.displayName ?? null,
                    planet.description ?? null,
                    planet.maxFuelColos ?? 0,
                    planet.maxOrgColos ?? 0,
                    planet.maxEquColos ?? 0,
                    planet.maxDroneColos ?? 0,
                    planet.maxFuel ?? 0,
                    planet.maxOrg ?? 0,
                    planet.maxEqu ?? 0,
                    planet.maxDrones ?? 0,
                    planet.maxCitadel ?? 0,
                    planet.fuelProduction ?? 0,
                    planet.organicsProduction ?? 0,
                    planet.equipmentProduction ?? 0,
                    planet.droneProduction ?? 0,
                    planet.danger ?? 0,
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
                ('Glacial', (SELECT id FROM edit_templates WHERE name = 'stock')),
                ('Jungle', (SELECT id FROM edit_templates WHERE name = 'stock')),
                ('Mountainous', (SELECT id FROM edit_templates WHERE name = 'stock')),
                ('Oceanic', (SELECT id FROM edit_templates WHERE name = 'stock')),
                ('Toxic', (SELECT id FROM edit_templates WHERE name = 'stock')),
                ('Volcanic', (SELECT id FROM edit_templates WHERE name = 'stock'))
            ON CONFLICT DO NOTHING
        `);

        // Audit log is per-session: previous-session entries were signed
        // with a key that no longer exists, so they can never verify.
        // Drop them at boot so the verifier sees a clean slate.
        await client.query('TRUNCATE TABLE audit_log RESTART IDENTITY');

        client.release();
        isConnected = true;
        console.log('PostgreSQL connected and schema verified');
    } catch (error) {
        console.error('PostgreSQL connection error:', error);
        throw error;
    }
};
