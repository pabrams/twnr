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
        sector_id INTEGER NOT NULL UNIQUE REFERENCES sectors(id) ON DELETE CASCADE,
        class INTEGER NOT NULL,
        fuel INTEGER NOT NULL DEFAULT 1000,
        fuel_price INTEGER NOT NULL,
        organics INTEGER NOT NULL DEFAULT 1000,
        org_price INTEGER NOT NULL,
        equipment INTEGER NOT NULL DEFAULT 1000,
        equ_price INTEGER NOT NULL
      );

      DO $$ 
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='planets' AND column_name='colonists') THEN
          DROP TABLE planets CASCADE;
        END IF;
      END $$;

      CREATE TABLE IF NOT EXISTS planets (
        id INTEGER NOT NULL,
        sector_id INTEGER NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
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
        PRIMARY KEY (id, universe_id)
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
        sector_id INTEGER NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
        owner_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL,
        PRIMARY KEY (sector_id)
      );

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
        action_type VARCHAR(10) NOT NULL CHECK (action_type IN ('local', 'server', 'mixed')),
        client_msg_type VARCHAR(100),
        target_menu_id INTEGER REFERENCES menu(id) ON DELETE SET NULL,
        sort_order SMALLINT NOT NULL DEFAULT 0,
        UNIQUE (menu_id, command_id)
      );

      ALTER TABLE players ADD COLUMN IF NOT EXISTS current_menu_id INTEGER REFERENCES menu(id) ON DELETE SET NULL;
    `);

        // Seed menu registry data (idempotent)
        await client.query(`
      -- Seed menus
      INSERT INTO menu (name, label) VALUES
        ('sector', 'Sector'),
        ('port', 'Port'),
        ('docked', 'Docked'),
        ('class0', 'Class 0 Port'),
        ('class0Qty', 'Class 0 Quantity'),
        ('help', 'Help'),
        ('shipInfo', 'Ship Info'),
        ('playerInfo', 'Player Info'),
        ('attack', 'Attack'),
        ('attackFighters', 'Attack Fighters'),
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
        ('deployFightersQty', 'Deploy Fighters'),
        ('fighterEncounter', 'Fighter Encounter'),
        ('fighterAttackQty', 'Fighter Attack')
      ON CONFLICT (name) DO NOTHING;

      -- Set parent menu relationships
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'sector')
        WHERE name IN ('port', 'help', 'shipInfo', 'playerInfo', 'attack', 'computer', 'jettisonConfirm', 'planet', 'deployFightersQty');
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'port')
        WHERE name = 'docked';
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'docked')
        WHERE name = 'class0';
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'class0')
        WHERE name = 'class0Qty';
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'attack')
        WHERE name = 'attackFighters';
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'computer')
        WHERE name IN ('knownUniverse', 'shipCatalog', 'planetSpecs', 'autopilotPrompt');
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'autopilotPrompt')
        WHERE name = 'autopilot';
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'planet')
        WHERE name IN ('planetTakeQty', 'planetLeaveQty');
      UPDATE menu SET parent_menu_id = (SELECT id FROM menu WHERE name = 'fighterEncounter')
        WHERE name = 'fighterAttackQty';

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
        ('deploy_fighters_info', 'Deploy fighters'),
        ('jettison_menu', 'Jettison cargo'),
        ('land', 'Land on planet'),
        ('quit_game', 'Quit'),
        -- Port commands
        ('trade_at_port', 'Trade at port'),
        -- Docked commands
        ('buy_goods', 'Buy goods'),
        ('sell_goods', 'Sell goods'),
        ('leave_port', 'Leave port'),
        -- Class0 commands
        ('choose_fighters', 'Buy fighters'),
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
        -- FighterEncounter commands
        ('attack_encounter', 'Attack'),
        ('retreat', 'Retreat')
      ON CONFLICT (name) DO NOTHING;

      -- Seed menu_command join rows
      -- Helper: m(menu_name), c(command_name), t(target_menu_name) via subqueries

      -- === Sector ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, action_type, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='move'), '<number>', 'Move to sector', 'server', 'move', NULL, 10),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='display_sector'), 'd', 'Display sector', 'server', 'sectorDisplay', NULL, 20),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='port_menu'), 'p', 'Port', 'server', NULL, (SELECT id FROM menu WHERE name='port'), 30),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='player_info'), 'i', 'Player info', 'server', NULL, (SELECT id FROM menu WHERE name='playerInfo'), 40),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='help_menu'), '?', 'Help', 'server', NULL, (SELECT id FROM menu WHERE name='help'), 50),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='attack_menu'), 'a', 'Attack', 'server', NULL, (SELECT id FROM menu WHERE name='attack'), 60),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='computer_menu'), 'c', 'Computer', 'server', NULL, (SELECT id FROM menu WHERE name='computer'), 70),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='deploy_fighters_info'), 'f', 'Deploy fighters', 'server', 'deployFightersInfo', NULL, 80),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='jettison_menu'), 'j', 'Jettison cargo', 'server', NULL, (SELECT id FROM menu WHERE name='jettisonConfirm'), 90),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='land'), 'l', 'Land', 'server', 'land', NULL, 100),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='quit_game'), 'q', 'Quit', 'local', NULL, NULL, 110),
        ((SELECT id FROM menu WHERE name='sector'), (SELECT id FROM command WHERE name='players_online'), '#', 'Players online', 'server', 'playersOnline', NULL, 120)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Port ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, action_type, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='port'), (SELECT id FROM command WHERE name='trade_at_port'), 't', 'Trade at port', 'server', 'dock', NULL, 10),
        ((SELECT id FROM menu WHERE name='port'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', 'server', NULL, (SELECT id FROM menu WHERE name='sector'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Docked ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, action_type, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='docked'), (SELECT id FROM command WHERE name='buy_goods'), 'b', 'Buy goods', 'server', 'portTransaction', NULL, 10),
        ((SELECT id FROM menu WHERE name='docked'), (SELECT id FROM command WHERE name='sell_goods'), 's', 'Sell goods', 'server', 'portTransaction', NULL, 20),
        ((SELECT id FROM menu WHERE name='docked'), (SELECT id FROM command WHERE name='leave_port'), 'q', 'Leave port', 'server', 'undock', NULL, 30)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Class0 ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, action_type, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='class0'), (SELECT id FROM command WHERE name='choose_fighters'), 'f', 'Buy fighters', 'server', NULL, (SELECT id FROM menu WHERE name='class0Qty'), 10),
        ((SELECT id FROM menu WHERE name='class0'), (SELECT id FROM command WHERE name='choose_shields'), 's', 'Buy shields', 'server', NULL, (SELECT id FROM menu WHERE name='class0Qty'), 20),
        ((SELECT id FROM menu WHERE name='class0'), (SELECT id FROM command WHERE name='choose_holds'), 'h', 'Buy holds', 'server', NULL, (SELECT id FROM menu WHERE name='class0Qty'), 30),
        ((SELECT id FROM menu WHERE name='class0'), (SELECT id FROM command WHERE name='leave_port'), 'q', 'Leave', 'server', 'undock', NULL, 40)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Class0Qty ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, action_type, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='class0Qty'), (SELECT id FROM command WHERE name='enter_quantity'), '<number>', 'Enter quantity', 'server', NULL, NULL, 10),
        ((SELECT id FROM menu WHERE name='class0Qty'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', 'server', NULL, (SELECT id FROM menu WHERE name='class0'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Help ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, action_type, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='help'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', 'server', NULL, (SELECT id FROM menu WHERE name='sector'), 10)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === ShipInfo ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, action_type, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='shipInfo'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', 'server', NULL, (SELECT id FROM menu WHERE name='sector'), 10)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === PlayerInfo ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, action_type, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='playerInfo'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', 'server', NULL, (SELECT id FROM menu WHERE name='sector'), 10)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Attack ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, action_type, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='attack'), (SELECT id FROM command WHERE name='select_target'), '<number>', 'Select target', 'server', NULL, (SELECT id FROM menu WHERE name='attackFighters'), 10),
        ((SELECT id FROM menu WHERE name='attack'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', 'server', NULL, (SELECT id FROM menu WHERE name='sector'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === AttackFighters ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, action_type, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='attackFighters'), (SELECT id FROM command WHERE name='enter_quantity'), '<number>', 'Fighters to send', 'server', 'attackShip', NULL, 10),
        ((SELECT id FROM menu WHERE name='attackFighters'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', 'server', NULL, (SELECT id FROM menu WHERE name='sector'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Computer ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, action_type, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='computer'), (SELECT id FROM command WHERE name='known_universe'), 'k', 'Known Universe', 'server', NULL, (SELECT id FROM menu WHERE name='knownUniverse'), 10),
        ((SELECT id FROM menu WHERE name='computer'), (SELECT id FROM command WHERE name='trader_list'), 'l', 'List Traders', 'server', NULL, NULL, 20),
        ((SELECT id FROM menu WHERE name='computer'), (SELECT id FROM command WHERE name='ship_catalog'), 'c', 'Ship Catalog', 'server', NULL, (SELECT id FROM menu WHERE name='shipCatalog'), 30),
        ((SELECT id FROM menu WHERE name='computer'), (SELECT id FROM command WHERE name='planet_specs'), 'j', 'Planetary Specs', 'server', NULL, (SELECT id FROM menu WHERE name='planetSpecs'), 40),
        ((SELECT id FROM menu WHERE name='computer'), (SELECT id FROM command WHERE name='current_ship_specs'), ';', 'Current Ship', 'server', NULL, NULL, 50),
        ((SELECT id FROM menu WHERE name='computer'), (SELECT id FROM command WHERE name='back'), 'q', 'Exit Computer', 'server', NULL, (SELECT id FROM menu WHERE name='sector'), 60)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === KnownUniverse ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, action_type, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='knownUniverse'), (SELECT id FROM command WHERE name='explored_sectors'), 'e', 'Explored sectors', 'server', NULL, NULL, 10),
        ((SELECT id FROM menu WHERE name='knownUniverse'), (SELECT id FROM command WHERE name='unexplored_sectors'), 'u', 'Unexplored sectors', 'server', NULL, NULL, 20),
        ((SELECT id FROM menu WHERE name='knownUniverse'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', 'server', NULL, (SELECT id FROM menu WHERE name='computer'), 30)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === ShipCatalog ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, action_type, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='shipCatalog'), (SELECT id FROM command WHERE name='view_detail'), '<letter>', 'View ship detail', 'server', NULL, NULL, 10),
        ((SELECT id FROM menu WHERE name='shipCatalog'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', 'server', NULL, (SELECT id FROM menu WHERE name='computer'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === PlanetSpecs ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, action_type, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='planetSpecs'), (SELECT id FROM command WHERE name='view_detail'), '<letter>', 'View planet detail', 'server', NULL, NULL, 10),
        ((SELECT id FROM menu WHERE name='planetSpecs'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', 'server', NULL, (SELECT id FROM menu WHERE name='computer'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === JettisonConfirm ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, action_type, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='jettisonConfirm'), (SELECT id FROM command WHERE name='confirm_yes'), 'y', 'Yes, jettison', 'server', 'jettison', (SELECT id FROM menu WHERE name='sector'), 10),
        ((SELECT id FROM menu WHERE name='jettisonConfirm'), (SELECT id FROM command WHERE name='confirm_no'), 'n', 'Cancel', 'server', NULL, (SELECT id FROM menu WHERE name='sector'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === Planet ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, action_type, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='planet'), (SELECT id FROM command WHERE name='take_colonists'), 't', 'Take colonists', 'server', NULL, (SELECT id FROM menu WHERE name='planetTakeQty'), 10),
        ((SELECT id FROM menu WHERE name='planet'), (SELECT id FROM command WHERE name='leave_colonists'), 'l', 'Leave colonists', 'server', NULL, (SELECT id FROM menu WHERE name='planetLeaveQty'), 20),
        ((SELECT id FROM menu WHERE name='planet'), (SELECT id FROM command WHERE name='back'), 'q', 'Leave planet', 'server', NULL, (SELECT id FROM menu WHERE name='sector'), 30)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === PlanetTakeQty ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, action_type, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='planetTakeQty'), (SELECT id FROM command WHERE name='enter_quantity'), '<number>', 'Quantity to take', 'server', 'takeColonists', NULL, 10),
        ((SELECT id FROM menu WHERE name='planetTakeQty'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', 'server', NULL, (SELECT id FROM menu WHERE name='sector'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === PlanetLeaveQty ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, action_type, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='planetLeaveQty'), (SELECT id FROM command WHERE name='enter_quantity'), '<number>', 'Quantity to leave', 'server', 'leaveColonists', NULL, 10),
        ((SELECT id FROM menu WHERE name='planetLeaveQty'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', 'server', NULL, (SELECT id FROM menu WHERE name='sector'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === DeployFightersQty ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, action_type, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='deployFightersQty'), (SELECT id FROM command WHERE name='enter_quantity'), '<number>', 'Fighters to deploy', 'server', 'deployFighters', NULL, 10),
        ((SELECT id FROM menu WHERE name='deployFightersQty'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', 'server', NULL, (SELECT id FROM menu WHERE name='sector'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === FighterEncounter ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, action_type, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='fighterEncounter'), (SELECT id FROM command WHERE name='attack_encounter'), 'a', 'Attack', 'server', NULL, (SELECT id FROM menu WHERE name='fighterAttackQty'), 10),
        ((SELECT id FROM menu WHERE name='fighterEncounter'), (SELECT id FROM command WHERE name='retreat'), 'r', 'Retreat', 'server', 'retreatFromFighters', NULL, 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === FighterAttackQty ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, action_type, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='fighterAttackQty'), (SELECT id FROM command WHERE name='enter_quantity'), '<number>', 'Fighters to send', 'server', 'attackSectorFighters', NULL, 10),
        ((SELECT id FROM menu WHERE name='fighterAttackQty'), (SELECT id FROM command WHERE name='back'), 'q', 'Back', 'server', NULL, (SELECT id FROM menu WHERE name='fighterEncounter'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- === AutopilotPrompt ===
      INSERT INTO menu_command (menu_id, command_id, key_pattern, label, action_type, client_msg_type, target_menu_id, sort_order) VALUES
        ((SELECT id FROM menu WHERE name='autopilotPrompt'), (SELECT id FROM command WHERE name='confirm_yes'), 'y', 'Engage autopilot', 'mixed', 'move', (SELECT id FROM menu WHERE name='autopilot'), 10),
        ((SELECT id FROM menu WHERE name='autopilotPrompt'), (SELECT id FROM command WHERE name='confirm_no'), 'n', 'Cancel', 'server', NULL, (SELECT id FROM menu WHERE name='sector'), 20)
      ON CONFLICT (menu_id, command_id) DO NOTHING;

      -- Autopilot has no commands (input ignored during autopilot)
    `);

        client.release();
        isConnected = true;
        console.log('PostgreSQL connected and schema verified');
    } catch (error) {
        console.error('PostgreSQL connection error:', error);
        process.exit(1);
    }
};
