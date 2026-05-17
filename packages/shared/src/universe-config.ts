// Values feeding default universe generation ('stock' template)
// See also the config/templates/stock folder
export const universeConfig = {
    startingCredits: 10000,
    startingDrones: 100,
    startingShields: 0,
    startingSector: 1,

    turnDelay: 10,
    turnsPerDay: 500,
    startingTurns: 1500,
    planetCollisionLikelihood: 50,
    planetCollisionMinHours: 24,
    planetCollisionMaxHours: 24,
    maxPlanetsPerSector: 2,
    respawnDelaySeconds: 86400,
    proximityMineDamage: 100,
    proximityDetonationPct: 50,
    seekerAttachPct: 25,
    seekerPickupDetectPct: 80,
    mineDisruptorMin: 3,
    mineDisruptorMax: 5,
    colosToProduceOneUnitPerHour: 1000,
    dailyReproductionPer1000Colos: 20,

    // bigbang generation knobs
    sectorCount: 500,
    warpDist: [20, 20, 23, 22, 10, 5] as readonly number[],
    twoWayPct: 95,
    portSpawnDensity: 80,
    topology: 'proximal' as 'random' | 'proximal',
    maxShortestPath: 'medium' as 'packed' | 'narrow' | 'medium' | 'wide' | 'vast',
    wormholesAlwaysTwoWay: true,
} as const;
