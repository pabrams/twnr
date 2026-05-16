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
import { scatterPositions } from './positions.js';

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
        fillDensity,
        maxPathLength,
    } = options;

    const rng = mulberry32(seed);

    function randomInt(min: number, max: number): number {
        return Math.floor(rng() * (max - min + 1)) + min;
    }

    const sectorNames = new Array(N + 1).fill('');
    sectorNames[1] = 'Federation Space';
    const starbaseId = randomInt(2, N);
    sectorNames[starbaseId] = 'Starbase';

    // Hex layout (proximal only) must happen before graph generation so the
    // RNG stream is seed-determined across topology modes.
    const layout = topology === 'proximal' ? scatterPositions(N, rng, fillDensity) : null;

    const forcedHubSectors: number[] = [1, starbaseId];
    const warps =
        topology === 'proximal' && layout
            ? generateProximalGraph(
                  N,
                  twoWayPct,
                  rng,
                  layout.cells,
                  maxPathLength,
                  forcedHubSectors,
                  warpDist,
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

    let numOtherPorts = totalPortsTarget - 1;
    if (numOtherPorts > N - 2) {
        numOtherPorts = N - 2;
    }

    const availableSectorsForPorts: number[] = [];
    for (let i = 2; i <= N; i++) {
        if (i !== starbaseId) {
            availableSectorsForPorts.push(i);
        }
    }
    // Shuffle
    for (let i = availableSectorsForPorts.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [availableSectorsForPorts[i], availableSectorsForPorts[j]] = [
            availableSectorsForPorts[j],
            availableSectorsForPorts[i],
        ];
    }

    let classPool: number[] = [];
    function getNextClass(): number {
        if (classPool.length === 0) {
            classPool = [1, 2, 3, 4, 5, 6, 7, 8];
            for (let i = classPool.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [classPool[i], classPool[j]] = [classPool[j], classPool[i]];
            }
        }
        return classPool.pop()!;
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

    return { seed, topology, sectors, warps, ports, planets };
}
