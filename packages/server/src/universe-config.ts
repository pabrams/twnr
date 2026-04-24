/**
 * Single source of truth for universe-bound defaults: both the player-starting
 * values (ship, credits, drones, ...) and the universe-mechanic values
 * (turns/day, planet collision, respawn delay, ...). The `edits` table's
 * column DEFAULTs interpolate from here, the seed UPDATE pushes these into
 * the 'stock' edit on every boot, and runtime COALESCE/?? fallbacks read from
 * here when a universe's edit row is missing or NULL.
 *
 * Edit a value here and restart the server — the schema sync propagates the
 * change to existing universes that still match the previous default, and any
 * new universe inherits the new value.
 */
export const universeConfig = {
    // ---- New-player starting values ----
    /** Ship type the player begins with on a fresh universe join. */
    startingShip: 'Vulpeculan Cruiser',
    /** Credits the player begins with. */
    startingCredits: 10000,
    /** Drones loaded onto the player's first ship. */
    startingDrones: 100,
    /** Shields loaded onto the player's first ship. */
    startingShields: 0,
    /** Sector number the player spawns in (and respawns in after destruction). */
    startingSector: 1,

    // ---- Universe mechanic values ----
    /** Server-side delay between turn-spending actions (milliseconds × cost). */
    turnDelay: 100,
    /** Daily turn allowance for the soft-cap regen mechanic. */
    turnsPerDay: 500,
    /** Player's initial turn balance when joining a new universe. */
    startingTurns: 500,
    /** Probability (%) that a planet collision check resolves to an actual collision. */
    planetCollisionLikelihood: 50,
    /** Minimum hours between collision events for a single planet. */
    planetCollisionMinHours: 24,
    /** Maximum hours between collision events for a single planet. */
    planetCollisionMaxHours: 24,
    /** Largest number of planets a single sector can hold simultaneously. */
    maxPlanetsPerSector: 2,
    /**
     * Cool-down (seconds) between losing a ship and being able to log back in.
     * Long enough that destruction isn't a viable way to refresh turns —
     * 24 hours by default. Override per-deployment with the
     * `SHIP_DESTROYED_LOGIN_DELAY_SECONDS` env var if a shorter window is
     * desirable for testing.
     */
    respawnDelaySeconds: 86400,
} as const;
