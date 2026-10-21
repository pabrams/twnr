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
import {
    PORT_CLASS_ACTIONS,
    MCIC_BIGBANG_RANGE,
    PRODUCTIVITY_BIGBANG_RANGE,
    type PriceCommodity,
} from '@twnr/shared';

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
        wormholesAlwaysTwoWay,
    } = options;

    const rng = mulberry32(seed);

    function randomInt(min: number, max: number): number {
        return Math.floor(rng() * (max - min + 1)) + min;
    }

    const sectorNames = new Array(N + 1).fill('');
    sectorNames[1] = 'Federation Space';
    const starbaseId = randomInt(2, N);
    sectorNames[starbaseId] = 'Starbase';

    // Extra class-0 count is capped at N-2 so distinct IDs never run out on small universes.
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

    const anchorSectorIds: number[] = [1, starbaseId, ...extraClassZeroSectorIds];

    // Layout must precede graph generation so the RNG stream stays seed-determined across topology modes.
    const rawLayout = topology === 'proximal' ? packHexCells(N, rng) : null;
    const layout =
        rawLayout && topology === 'proximal'
            ? arrangeAnchors(rawLayout, anchorSectorIds)
            : rawLayout;

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
                  wormholesAlwaysTwoWay,
              )
            : generateGraph(N, twoWayPct, rng, warpDist, forcedHubSectors);

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
        const actions = PORT_CLASS_ACTIONS[portClass];
        const generateCommodity = (commodity: PriceCommodity, action: 'B' | 'S') => {
            const prod = randomInt(PRODUCTIVITY_BIGBANG_RANGE.min, PRODUCTIVITY_BIGBANG_RANGE.max);
            const max = prod * 10;
            const range = MCIC_BIGBANG_RANGE[commodity];
            const mag = randomInt(range.min, range.max);
            // MCIC sign convention: B → negative (port pays more), S → positive (port charges more).
            const mcic = action === 'B' ? -mag : mag;
            const qty = action === 'S' ? max : 0;
            return { qty, max, prod, mcic };
        };
        const fuel = generateCommodity('fuel', actions.fuel);
        const org = generateCommodity('organics', actions.organics);
        const equ = generateCommodity('equipment', actions.equipment);
        return {
            sector: sectorId,
            class: portClass,
            fuel_qty: fuel.qty,
            fuel_max: fuel.max,
            fuel_prod: fuel.prod,
            fuel_mcic: fuel.mcic,
            org_qty: org.qty,
            org_max: org.max,
            org_prod: org.prod,
            org_mcic: org.mcic,
            equ_qty: equ.qty,
            equ_max: equ.max,
            equ_prod: equ.prod,
            equ_mcic: equ.mcic,
        };
    }

    // Starbase generates as class 8; overridden to 9 at insert time.
    ports.push(generatePort(starbaseId, 8));

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
    for (let i = availableSectorsForPorts.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [availableSectorsForPorts[i], availableSectorsForPorts[j]] = [
            availableSectorsForPorts[j],
            availableSectorsForPorts[i],
        ];
    }

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
