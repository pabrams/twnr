--
-- PostgreSQL database dump
--

\restrict 0BJTGiyWLop1XUqolwwPNbrBwrREz3ZSZyCYPcNI0m0LNpeQEWNR6OgHlodf86U

-- Dumped from database version 18.3
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: trigger_set_timestamp(); Type: FUNCTION; Schema: public; Owner: twnr_user
--

CREATE FUNCTION public.trigger_set_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$;


ALTER FUNCTION public.trigger_set_timestamp() OWNER TO twnr_user;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: command; Type: TABLE; Schema: public; Owner: twnr_user
--

CREATE TABLE public.command (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    label character varying(255) NOT NULL
);


ALTER TABLE public.command OWNER TO twnr_user;

--
-- Name: command_id_seq; Type: SEQUENCE; Schema: public; Owner: twnr_user
--

CREATE SEQUENCE public.command_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.command_id_seq OWNER TO twnr_user;

--
-- Name: command_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: twnr_user
--

ALTER SEQUENCE public.command_id_seq OWNED BY public.command.id;


--
-- Name: menu; Type: TABLE; Schema: public; Owner: twnr_user
--

CREATE TABLE public.menu (
    id integer NOT NULL,
    name character varying(50) NOT NULL,
    label character varying(100) NOT NULL,
    parent_menu_id integer
);


ALTER TABLE public.menu OWNER TO twnr_user;

--
-- Name: menu_command; Type: TABLE; Schema: public; Owner: twnr_user
--

CREATE TABLE public.menu_command (
    id integer NOT NULL,
    menu_id integer NOT NULL,
    command_id integer NOT NULL,
    key_pattern character varying(50) NOT NULL,
    label character varying(255),
    action_type character varying(10) NOT NULL,
    client_msg_type character varying(100),
    target_menu_id integer,
    sort_order smallint DEFAULT 0 NOT NULL,
    CONSTRAINT menu_command_action_type_check CHECK (((action_type)::text = ANY ((ARRAY['local'::character varying, 'server'::character varying, 'mixed'::character varying])::text[])))
);


ALTER TABLE public.menu_command OWNER TO twnr_user;

--
-- Name: menu_command_id_seq; Type: SEQUENCE; Schema: public; Owner: twnr_user
--

CREATE SEQUENCE public.menu_command_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.menu_command_id_seq OWNER TO twnr_user;

--
-- Name: menu_command_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: twnr_user
--

ALTER SEQUENCE public.menu_command_id_seq OWNED BY public.menu_command.id;


--
-- Name: menu_id_seq; Type: SEQUENCE; Schema: public; Owner: twnr_user
--

CREATE SEQUENCE public.menu_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.menu_id_seq OWNER TO twnr_user;

--
-- Name: menu_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: twnr_user
--

ALTER SEQUENCE public.menu_id_seq OWNED BY public.menu.id;


--
-- Name: planet_collisions; Type: TABLE; Schema: public; Owner: twnr_user
--

CREATE TABLE public.planet_collisions (
    collision_planet integer NOT NULL,
    colliding_with integer NOT NULL,
    universe_id integer NOT NULL,
    collision_at timestamp with time zone NOT NULL
);


ALTER TABLE public.planet_collisions OWNER TO twnr_user;

--
-- Name: planets; Type: TABLE; Schema: public; Owner: twnr_user
--

CREATE TABLE public.planets (
    id integer NOT NULL,
    sector_id integer NOT NULL,
    universe_id integer NOT NULL,
    name character varying(255) NOT NULL,
    type character varying(255) DEFAULT 'Terran'::character varying NOT NULL,
    drones smallint DEFAULT 0 NOT NULL,
    fuel smallint DEFAULT 0 NOT NULL,
    organics smallint DEFAULT 0 NOT NULL,
    equipment smallint DEFAULT 0 NOT NULL,
    colonists_fuel smallint DEFAULT 0 NOT NULL,
    colonists_organics smallint DEFAULT 0 NOT NULL,
    colonists_equipment smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


ALTER TABLE public.planets OWNER TO twnr_user;

--
-- Name: player_ships; Type: TABLE; Schema: public; Owner: twnr_user
--

CREATE TABLE public.player_ships (
    player_id integer NOT NULL,
    ship_name character varying(255) NOT NULL,
    drones integer DEFAULT 0 NOT NULL,
    shields integer DEFAULT 0 NOT NULL,
    cargo_limit integer NOT NULL,
    planet_busters smallint DEFAULT 0 NOT NULL,
    terraform_devices smallint DEFAULT 0 NOT NULL,
    turns_per_warp integer DEFAULT 1 NOT NULL,
    has_hyperwarp_drive boolean DEFAULT false NOT NULL
);


ALTER TABLE public.player_ships OWNER TO twnr_user;

--
-- Name: players; Type: TABLE; Schema: public; Owner: twnr_user
--

CREATE TABLE public.players (
    id integer NOT NULL,
    name character varying(255),
    user_id integer NOT NULL,
    universe_id integer NOT NULL,
    current_sector integer,
    ship_destroyed_date timestamp with time zone,
    docked boolean DEFAULT false NOT NULL,
    on_planet_id integer,
    turns integer DEFAULT 0 NOT NULL,
    last_turns_granted_at timestamp with time zone DEFAULT now() NOT NULL,
    current_menu_id integer
);


ALTER TABLE public.players OWNER TO twnr_user;

--
-- Name: players_id_seq; Type: SEQUENCE; Schema: public; Owner: twnr_user
--

CREATE SEQUENCE public.players_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.players_id_seq OWNER TO twnr_user;

--
-- Name: players_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: twnr_user
--

ALTER SEQUENCE public.players_id_seq OWNED BY public.players.id;


--
-- Name: ports; Type: TABLE; Schema: public; Owner: twnr_user
--

CREATE TABLE public.ports (
    id integer NOT NULL,
    sector_id integer NOT NULL,
    class integer NOT NULL,
    fuel integer DEFAULT 1000 NOT NULL,
    fuel_price integer NOT NULL,
    organics integer DEFAULT 1000 NOT NULL,
    org_price integer NOT NULL,
    equipment integer DEFAULT 1000 NOT NULL,
    equ_price integer NOT NULL
);


ALTER TABLE public.ports OWNER TO twnr_user;

--
-- Name: ports_id_seq; Type: SEQUENCE; Schema: public; Owner: twnr_user
--

CREATE SEQUENCE public.ports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ports_id_seq OWNER TO twnr_user;

--
-- Name: ports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: twnr_user
--

ALTER SEQUENCE public.ports_id_seq OWNED BY public.ports.id;


--
-- Name: sector_drones; Type: TABLE; Schema: public; Owner: twnr_user
--

CREATE TABLE public.sector_drones (
    sector_id integer NOT NULL,
    owner_id integer NOT NULL,
    quantity integer NOT NULL
);


ALTER TABLE public.sector_drones OWNER TO twnr_user;

--
-- Name: sectors; Type: TABLE; Schema: public; Owner: twnr_user
--

CREATE TABLE public.sectors (
    id integer NOT NULL,
    universe_id integer NOT NULL,
    sector_number integer NOT NULL,
    name character varying(255)
);


ALTER TABLE public.sectors OWNER TO twnr_user;

--
-- Name: sectors_id_seq; Type: SEQUENCE; Schema: public; Owner: twnr_user
--

CREATE SEQUENCE public.sectors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.sectors_id_seq OWNER TO twnr_user;

--
-- Name: sectors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: twnr_user
--

ALTER SEQUENCE public.sectors_id_seq OWNED BY public.sectors.id;


--
-- Name: ship_cargo; Type: TABLE; Schema: public; Owner: twnr_user
--

CREATE TABLE public.ship_cargo (
    player_id integer NOT NULL,
    fuel integer DEFAULT 0 NOT NULL,
    organics integer DEFAULT 0 NOT NULL,
    equipment integer DEFAULT 0 NOT NULL,
    colonists integer DEFAULT 0 NOT NULL,
    credits integer DEFAULT 10000 NOT NULL
);


ALTER TABLE public.ship_cargo OWNER TO twnr_user;

--
-- Name: universes; Type: TABLE; Schema: public; Owner: twnr_user
--

CREATE TABLE public.universes (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    seed integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    max_planets_per_sector smallint DEFAULT 2 NOT NULL,
    planet_collision_likelihood smallint DEFAULT 50 NOT NULL,
    planet_collision_min_hours smallint DEFAULT 24 NOT NULL,
    planet_collision_max_hours smallint DEFAULT 24 NOT NULL,
    turns_per_day integer DEFAULT 500 NOT NULL,
    starting_turns integer DEFAULT 500 NOT NULL,
    max_turns integer DEFAULT 2000 NOT NULL
);


ALTER TABLE public.universes OWNER TO twnr_user;

--
-- Name: universes_id_seq; Type: SEQUENCE; Schema: public; Owner: twnr_user
--

CREATE SEQUENCE public.universes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.universes_id_seq OWNER TO twnr_user;

--
-- Name: universes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: twnr_user
--

ALTER SEQUENCE public.universes_id_seq OWNED BY public.universes.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: twnr_user
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    role character varying(50) DEFAULT 'player'::character varying NOT NULL,
    token_version integer DEFAULT 1 NOT NULL
);


ALTER TABLE public.users OWNER TO twnr_user;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: twnr_user
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO twnr_user;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: twnr_user
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: visited_sectors; Type: TABLE; Schema: public; Owner: twnr_user
--

CREATE TABLE public.visited_sectors (
    player_id integer NOT NULL,
    sector_id integer NOT NULL
);


ALTER TABLE public.visited_sectors OWNER TO twnr_user;

--
-- Name: warps; Type: TABLE; Schema: public; Owner: twnr_user
--

CREATE TABLE public.warps (
    from_sector_id integer NOT NULL,
    to_sector_id integer NOT NULL
);


ALTER TABLE public.warps OWNER TO twnr_user;

--
-- Name: command id; Type: DEFAULT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.command ALTER COLUMN id SET DEFAULT nextval('public.command_id_seq'::regclass);


--
-- Name: menu id; Type: DEFAULT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.menu ALTER COLUMN id SET DEFAULT nextval('public.menu_id_seq'::regclass);


--
-- Name: menu_command id; Type: DEFAULT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.menu_command ALTER COLUMN id SET DEFAULT nextval('public.menu_command_id_seq'::regclass);


--
-- Name: players id; Type: DEFAULT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.players ALTER COLUMN id SET DEFAULT nextval('public.players_id_seq'::regclass);


--
-- Name: ports id; Type: DEFAULT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.ports ALTER COLUMN id SET DEFAULT nextval('public.ports_id_seq'::regclass);


--
-- Name: sectors id; Type: DEFAULT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.sectors ALTER COLUMN id SET DEFAULT nextval('public.sectors_id_seq'::regclass);


--
-- Name: universes id; Type: DEFAULT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.universes ALTER COLUMN id SET DEFAULT nextval('public.universes_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: command command_name_key; Type: CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.command
    ADD CONSTRAINT command_name_key UNIQUE (name);


--
-- Name: command command_pkey; Type: CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.command
    ADD CONSTRAINT command_pkey PRIMARY KEY (id);


--
-- Name: menu_command menu_command_menu_id_command_id_key; Type: CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.menu_command
    ADD CONSTRAINT menu_command_menu_id_command_id_key UNIQUE (menu_id, command_id);


--
-- Name: menu_command menu_command_pkey; Type: CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.menu_command
    ADD CONSTRAINT menu_command_pkey PRIMARY KEY (id);


--
-- Name: menu menu_name_key; Type: CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.menu
    ADD CONSTRAINT menu_name_key UNIQUE (name);


--
-- Name: menu menu_pkey; Type: CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.menu
    ADD CONSTRAINT menu_pkey PRIMARY KEY (id);


--
-- Name: planet_collisions planet_collisions_pkey; Type: CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.planet_collisions
    ADD CONSTRAINT planet_collisions_pkey PRIMARY KEY (collision_planet, colliding_with, universe_id);


--
-- Name: planets planets_pkey; Type: CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.planets
    ADD CONSTRAINT planets_pkey PRIMARY KEY (id, universe_id);


--
-- Name: player_ships player_ships_pkey; Type: CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.player_ships
    ADD CONSTRAINT player_ships_pkey PRIMARY KEY (player_id);


--
-- Name: players players_pkey; Type: CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_pkey PRIMARY KEY (id);


--
-- Name: players players_user_id_universe_id_key; Type: CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_user_id_universe_id_key UNIQUE (user_id, universe_id);


--
-- Name: ports ports_pkey; Type: CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.ports
    ADD CONSTRAINT ports_pkey PRIMARY KEY (id);


--
-- Name: ports ports_sector_id_key; Type: CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.ports
    ADD CONSTRAINT ports_sector_id_key UNIQUE (sector_id);


--
-- Name: sector_drones sector_drones_pkey; Type: CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.sector_drones
    ADD CONSTRAINT sector_drones_pkey PRIMARY KEY (sector_id);


--
-- Name: sectors sectors_pkey; Type: CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.sectors
    ADD CONSTRAINT sectors_pkey PRIMARY KEY (id);


--
-- Name: sectors sectors_universe_id_sector_number_key; Type: CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.sectors
    ADD CONSTRAINT sectors_universe_id_sector_number_key UNIQUE (universe_id, sector_number);


--
-- Name: ship_cargo ship_cargo_pkey; Type: CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.ship_cargo
    ADD CONSTRAINT ship_cargo_pkey PRIMARY KEY (player_id);


--
-- Name: universes universes_pkey; Type: CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.universes
    ADD CONSTRAINT universes_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: visited_sectors visited_sectors_pkey; Type: CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.visited_sectors
    ADD CONSTRAINT visited_sectors_pkey PRIMARY KEY (player_id, sector_id);


--
-- Name: warps warps_pkey; Type: CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.warps
    ADD CONSTRAINT warps_pkey PRIMARY KEY (from_sector_id, to_sector_id);


--
-- Name: planets set_timestamp_planets; Type: TRIGGER; Schema: public; Owner: twnr_user
--

CREATE TRIGGER set_timestamp_planets BEFORE UPDATE ON public.planets FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();


--
-- Name: menu_command menu_command_command_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.menu_command
    ADD CONSTRAINT menu_command_command_id_fkey FOREIGN KEY (command_id) REFERENCES public.command(id) ON DELETE CASCADE;


--
-- Name: menu_command menu_command_menu_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.menu_command
    ADD CONSTRAINT menu_command_menu_id_fkey FOREIGN KEY (menu_id) REFERENCES public.menu(id) ON DELETE CASCADE;


--
-- Name: menu_command menu_command_target_menu_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.menu_command
    ADD CONSTRAINT menu_command_target_menu_id_fkey FOREIGN KEY (target_menu_id) REFERENCES public.menu(id) ON DELETE SET NULL;


--
-- Name: menu menu_parent_menu_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.menu
    ADD CONSTRAINT menu_parent_menu_id_fkey FOREIGN KEY (parent_menu_id) REFERENCES public.menu(id) ON DELETE SET NULL;


--
-- Name: planet_collisions planet_collisions_colliding_with_universe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.planet_collisions
    ADD CONSTRAINT planet_collisions_colliding_with_universe_id_fkey FOREIGN KEY (colliding_with, universe_id) REFERENCES public.planets(id, universe_id) ON DELETE CASCADE;


--
-- Name: planet_collisions planet_collisions_collision_planet_universe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.planet_collisions
    ADD CONSTRAINT planet_collisions_collision_planet_universe_id_fkey FOREIGN KEY (collision_planet, universe_id) REFERENCES public.planets(id, universe_id) ON DELETE CASCADE;


--
-- Name: planet_collisions planet_collisions_universe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.planet_collisions
    ADD CONSTRAINT planet_collisions_universe_id_fkey FOREIGN KEY (universe_id) REFERENCES public.universes(id) ON DELETE CASCADE;


--
-- Name: planets planets_sector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.planets
    ADD CONSTRAINT planets_sector_id_fkey FOREIGN KEY (sector_id) REFERENCES public.sectors(id) ON DELETE CASCADE;


--
-- Name: planets planets_universe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.planets
    ADD CONSTRAINT planets_universe_id_fkey FOREIGN KEY (universe_id) REFERENCES public.universes(id) ON DELETE CASCADE;


--
-- Name: player_ships player_ships_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.player_ships
    ADD CONSTRAINT player_ships_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;


--
-- Name: players players_current_menu_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_current_menu_id_fkey FOREIGN KEY (current_menu_id) REFERENCES public.menu(id) ON DELETE SET NULL;


--
-- Name: players players_universe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_universe_id_fkey FOREIGN KEY (universe_id) REFERENCES public.universes(id);


--
-- Name: players players_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: ports ports_sector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.ports
    ADD CONSTRAINT ports_sector_id_fkey FOREIGN KEY (sector_id) REFERENCES public.sectors(id) ON DELETE CASCADE;


--
-- Name: sector_drones sector_drones_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.sector_drones
    ADD CONSTRAINT sector_drones_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.players(id) ON DELETE CASCADE;


--
-- Name: sector_drones sector_drones_sector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.sector_drones
    ADD CONSTRAINT sector_drones_sector_id_fkey FOREIGN KEY (sector_id) REFERENCES public.sectors(id) ON DELETE CASCADE;


--
-- Name: sectors sectors_universe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.sectors
    ADD CONSTRAINT sectors_universe_id_fkey FOREIGN KEY (universe_id) REFERENCES public.universes(id) ON DELETE CASCADE;


--
-- Name: visited_sectors visited_sectors_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.visited_sectors
    ADD CONSTRAINT visited_sectors_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;


--
-- Name: warps warps_from_sector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.warps
    ADD CONSTRAINT warps_from_sector_id_fkey FOREIGN KEY (from_sector_id) REFERENCES public.sectors(id) ON DELETE CASCADE;


--
-- Name: warps warps_to_sector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: twnr_user
--

ALTER TABLE ONLY public.warps
    ADD CONSTRAINT warps_to_sector_id_fkey FOREIGN KEY (to_sector_id) REFERENCES public.sectors(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict 0BJTGiyWLop1XUqolwwPNbrBwrREz3ZSZyCYPcNI0m0LNpeQEWNR6OgHlodf86U

