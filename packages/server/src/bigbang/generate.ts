import type {
    BigBangOptions,
    BigBangResult,
    GeneratedSector,
    GeneratedPort,
    GeneratedPlanet,
} from './types.js';
import { mulberry32 } from './prng.js';
import { generateGraph } from './graph.js';
import { generateProximalGraph } from './graph-proximal.js';
import { packHexCells, arrangeAnchors } from './positions.js';
import { portClassesConfig } from '../game-config.js';

const portClasses: Record<number, string[]> = {
    1: ['B', 'B', 'S'],
    2: ['B', 'S', 'B'],
    3: ['S', 'B', 'B'],
    4: ['S', 'S', 'B'],
    5: ['B', 'S', 'S'],
    6: ['S', 'B', 'S'],
    7: ['S', 'S', 'S'],
    8: ['B', 'B', 'B'],
};

export function generateUniverse(options: BigBangOptions): BigBangResult {
    const {
        sectors: N,
        seed,
        portDensity,
        planetDensity,
        twoWayPct,
        warpDist,
        topology,
        additionalClassZeroPorts,
        maxShortestPath,
    } = options;

    const rng = mulberry32(seed);

    function randomInt(min: number, max: number): number {
        return Math.floor(rng() * (max - min + 1)) + min;
    }

    const sectorNames = new Array(N + 1).fill('');
    sectorNames[1] = 'Federation Space';
    const starbaseId = randomInt(2, N);
    sectorNames[starbaseId] = 'Starbase';

    // Pick additional class-0 sector IDs (random, distinct from sector 1 and
    // starbase). Capped at N-2 so we never run out of distinct IDs on small
    // universes; the requested count is honoured up to that ceiling.
    const extraClassZeroSectorIds: number[] = [];
    const desiredExtras = Math.max(0, Math.min(additionalClassZeroPorts, N - 2));
    const usedIds = new Set<number>([1, starbaseId]);
    while (extraClassZeroSectorIds.length < desiredExtras) {
        const candidate = randomInt(2, N);
        if (usedIds.has(candidate)) continue;
        usedIds.add(candidate);
        extraClassZeroSectorIds.push(candidate);
        sectorNames[candidate] = 'Federation Outpost';
    }

    // Anchor list: sector 1 first (so it lands on the centroid-closest cell —
    // Federation Space is "the heart"), then starbase, then extras. Order
    // matters because arrangeAnchors does farthest-first traversal after the
    // central pick, and graph-proximal honours the same order for its
    // guaranteed/target hub fixup.
    const anchorSectorIds: number[] = [1, starbaseId, ...extraClassZeroSectorIds];

    // Hex layout (proximal only) must happen before graph generation so the
    // RNG stream is seed-determined across topology modes.
    const rawLayout = topology === 'proximal' ? packHexCells(N, rng) : null;
    const layout =
        rawLayout && topology === 'proximal' ? arrangeAnchors(rawLayout, anchorSectorIds) : rawLayout;

    const forcedHubSectors: number[] = anchorSectorIds;
    const warps =
        topology === 'proximal' && layout
            ? generateProximalGraph(
                  N,
                  twoWayPct,
                  rng,
                  layout.cells,
                  forcedHubSectors,
                  warpDist,
                  maxShortestPath,
              )
            : generateGraph(N, twoWayPct, rng, warpDist, forcedHubSectors);

    // Generate sectors. Hex centers are authoritative; no client-side or
    // post-hoc relaxation moves them.
    const sectors: GeneratedSector[] = [];
    for (let i = 1; i <= N; i++) {
        sectors.push({
            id: i,
            name: sectorNames[i],
            x: layout ? layout.positions[i - 1].x : null,
            y: layout ? layout.positions[i - 1].y : null,
        });
    }

    const totalPortsTarget = Math.max(1, Math.round((N * portDensity) / 100));
    const ports: GeneratedPort[] = [];

    function generatePort(sectorId: number, portClass: number): GeneratedPort {
        const pClassStr = portClasses[portClass];
        const generateCommodity = (type: string) => {
            const qty = randomInt(0, 5000);
            const price = type === 'S' ? randomInt(10, 50) : randomInt(51, 100);
            return { qty, price };
        };
        const fuel = generateCommodity(pClassStr[0]);
        const org = generateCommodity(pClassStr[1]);
        const equ = generateCommodity(pClassStr[2]);
        return {
            sector: sectorId,
            class: portClass,
            fuel_qty: fuel.qty,
            fuel_max: fuel.qty,
            fuel_price: fuel.price,
            org_qty: org.qty,
            org_max: org.qty,
            org_price: org.price,
            equ_qty: equ.qty,
            equ_max: equ.qty,
            equ_price: equ.price,
        };
    }

    // Starbase always gets a port (class 8 in generation, will be overridden to 9 later)
    ports.push(generatePort(starbaseId, 8));

    // totalPortsTarget covers all ports (incl. starbase + class-0 hubs).
    // Subtract the specials so the "other" pool fills the rest.
    let numOtherPorts = totalPortsTarget - 1 - extraClassZeroSectorIds.length;
    const maxOtherPorts = N - 2 - extraClassZeroSectorIds.length;
    if (numOtherPorts > maxOtherPorts) numOtherPorts = maxOtherPorts;
    if (numOtherPorts < 0) numOtherPorts = 0;

    const extraClassZeroSet = new Set<number>(extraClassZeroSectorIds);
    const availableSectorsForPorts: number[] = [];
    for (let i = 2; i <= N; i++) {
        if (i === starbaseId) continue;
        if (extraClassZeroSet.has(i)) continue;
        availableSectorsForPorts.push(i);
    }
    // Shuffle
    for (let i = availableSectorsForPorts.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [availableSectorsForPorts[i], availableSectorsForPorts[j]] = [
            availableSectorsForPorts[j],
            availableSectorsForPorts[i],
        ];
    }

    // Weighted-random class picker from port-classes.json. Class codes
    // (BBS/BSB/...) stay in `portClasses` above; only the per-class
    // population shares are tunable. Falls back to class 1 if all weights
    // are zero (shouldn't happen with the shipped config).
    const portClassWeights = portClassesConfig.generationShares;
    const portClassKeys = Object.keys(portClassWeights)
        .map(Number)
        .filter((k) => Number.isInteger(k) && k >= 1 && k <= 8)
        .sort((a, b) => a - b);
    const portClassTotalWeight = portClassKeys.reduce(
        (s, k) => s + Math.max(0, portClassWeights[String(k)] ?? 0),
        0,
    );
    function getNextClass(): number {
        if (portClassTotalWeight <= 0) return 1;
        let r = rng() * portClassTotalWeight;
        for (const k of portClassKeys) {
            r -= Math.max(0, portClassWeights[String(k)] ?? 0);
            if (r <= 0) return k;
        }
        return portClassKeys[portClassKeys.length - 1] ?? 1;
    }

    for (let i = 0; i < numOtherPorts; i++) {
        const sectorId = availableSectorsForPorts[i];
        const pClass = getNextClass();
        ports.push(generatePort(sectorId, pClass));
    }

    ports.sort((a, b) => a.sector - b.sector);

    const planets: GeneratedPlanet[] = [{ sector: 1, name: 'Earth', type: 'Terran' }];

    if (planetDensity > 0) {
        let totalPlanetSectors = Math.round((N * planetDensity) / 100);
        if (totalPlanetSectors > N - 1) totalPlanetSectors = N - 1;

        const availableSectorsForPlanets: number[] = [];
        for (let i = 2; i <= N; i++) availableSectorsForPlanets.push(i);
        for (let i = availableSectorsForPlanets.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [availableSectorsForPlanets[i], availableSectorsForPlanets[j]] = [
                availableSectorsForPlanets[j],
                availableSectorsForPlanets[i],
            ];
        }

        const planetTypesPool = ['Terran', 'Volcanic', 'Glacial', 'Gas Giant', 'Mountainous'];
        let pTypePool: string[] = [];
        function getNextPlanetType(): string {
            if (pTypePool.length === 0) {
                pTypePool = [...planetTypesPool];
                for (let i = pTypePool.length - 1; i > 0; i--) {
                    const j = Math.floor(rng() * (i + 1));
                    [pTypePool[i], pTypePool[j]] = [pTypePool[j], pTypePool[i]];
                }
            }
            return pTypePool.pop()!;
        }

        for (let i = 0; i < totalPlanetSectors; i++) {
            const sectorId = availableSectorsForPlanets[i];
            const numPlanets = randomInt(1, 3);
            for (let p = 1; p <= numPlanets; p++) {
                const pType = getNextPlanetType();
                planets.push({
                    sector: sectorId,
                    name: `${pType}-${sectorId}-${p}`,
                    type: pType,
                });
            }
        }
        planets.sort((a, b) =>
            a.sector !== b.sector ? a.sector - b.sector : a.name.localeCompare(b.name),
        );
    }

    return { seed, topology, sectors, warps, ports, planets, extraClassZeroSectorIds };
}
