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
    startingShip: 'Vulpeculan Cruiser',
    startingCredits: 10000,
    startingDrones: 100,
    startingShields: 0,
    startingSector: 1,

    turnDelay: 10,
    turnsPerDay: 500,
    startingTurns: 500,
    planetCollisionLikelihood: 50,
    planetCollisionMinHours: 24,
    planetCollisionMaxHours: 24,
    maxPlanetsPerSector: 2,
    respawnDelaySeconds: 86400,
} as const;
