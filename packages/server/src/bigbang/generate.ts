import type { BigBangOptions, BigBangResult, GeneratedSector, GeneratedPort } from './types.js';
import { mulberry32 } from './prng.js';
import { generateGraph } from './graph.js';

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
    const N = options.sectors;
    const portDensity = options.portDensity ?? 50;
    const twoWayPct = options.twoWayPct ?? 90;
    const seed = options.seed ?? Math.floor(Math.random() * 2147483647);

    const rng = mulberry32(seed);

    function randomInt(min: number, max: number): number {
        return Math.floor(rng() * (max - min + 1)) + min;
    }

    // Generate sector names
    const sectorNames = new Array(N + 1).fill('');
    sectorNames[1] = 'Federation Space';
    const starbaseId = randomInt(2, N);
    sectorNames[starbaseId] = 'Starbase';

    // Generate graph
    const warps = generateGraph(N, twoWayPct, rng);

    // Generate sectors
    const sectors: GeneratedSector[] = [];
    for (let i = 1; i <= N; i++) {
        sectors.push({ id: i, name: sectorNames[i] });
    }

    // Generate ports
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

    return { seed, sectors, warps, ports };
}
