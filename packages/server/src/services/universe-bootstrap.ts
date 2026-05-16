import { universeConfig } from '@twnr/shared';
import { withTransaction } from '../db/index.js';
import { generateUniverse } from '../bigbang/index.js';
import {
    insertUniverseFull,
    getTemplateIdByName,
    snapshotTemplateForUniverse,
    getEarthStartingColonistsForUniverse,
} from '../db/queries/universe.js';
import { insertSector, insertWarp, getStarbaseSectorNumber } from '../db/queries/sector.js';
import { insertGeneratedPort, upsertSpecialPort } from '../db/queries/port.js';
import { insertUnownedPlanet, setEarthColonists } from '../db/queries/planet.js';
import { invalidateGraphCache } from '../state/graph-cache.js';

/**
 * Generate a universe from defaults and persist all the rows (sectors, warps,
 * ports, Earth, starbase). Used by the admin "generate" endpoint and also by
 * the guest endpoint when no universe exists yet.
 *
 * Returns the new universe id. Defaults are tuned for a quick demo.
 */
export async function bootstrapUniverse(name: string): Promise<number> {
    // Topology + warp distribution + two-way pct + port density all come from
    // the shared DEFAULT_* constants via generateUniverse — don't override
    // them here.
    const result = generateUniverse({
        sectors: universeConfig.sectorCount,
    });

    const universeId = await withTransaction(async (client) => {
        const templateId = await getTemplateIdByName('stock', client);
        const newUniverseId = await insertUniverseFull(
            name,
            result.seed,
            templateId,
            client,
            result.topology,
        );
        await snapshotTemplateForUniverse(newUniverseId, 'stock', client);

        const sectorIdMap = new Map<number, number>();
        for (const s of result.sectors) {
            const id = await insertSector(newUniverseId, s.id, s.name, client, s.x, s.y);
            sectorIdMap.set(s.id, id);
        }

        for (const w of result.warps) {
            await insertWarp(sectorIdMap.get(w.from)!, sectorIdMap.get(w.to)!, client);
        }

        for (const p of result.ports) {
            await insertGeneratedPort(
                sectorIdMap.get(p.sector)!,
                p.class,
                {
                    fuelQty: p.fuel_qty,
                    fuelPrice: p.fuel_price,
                    orgQty: p.org_qty,
                    orgPrice: p.org_price,
                    equQty: p.equ_qty,
                    equPrice: p.equ_price,
                },
                client,
            );
        }

        const sector1Id = sectorIdMap.get(1)!;
        await upsertSpecialPort(sector1Id, 0, client);

        const starbaseSectorNumber = await getStarbaseSectorNumber(newUniverseId, client);
        if (starbaseSectorNumber !== null) {
            const starbaseSectorDbId = sectorIdMap.get(starbaseSectorNumber);
            if (starbaseSectorDbId !== undefined) {
                await upsertSpecialPort(starbaseSectorDbId, 9, client);
            }
        }

        for (const p of result.planets) {
            const sectorDbId = sectorIdMap.get(p.sector);
            if (sectorDbId === undefined) continue;
            await insertUnownedPlanet(sectorDbId, p.name, p.type, client);
        }
        const earthCol = await getEarthStartingColonistsForUniverse(newUniverseId, client);
        await setEarthColonists(sector1Id, earthCol, client);

        return newUniverseId;
    });

    invalidateGraphCache(universeId!);
    return universeId!;
}
