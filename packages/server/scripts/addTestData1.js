#!/usr/bin/env node
/**
 * addTestData1.js — populate a fresh DB (post db:reseed) with a hand-crafted
 * test universe.
 *
 *   • 3 users (email "1@1.1" / pw "1", …, "3@3.3" / pw "3")
 *   • universe "test" with 1000 sectors (otherwise default parameters)
 *   • 3 players ("1", "2", "3") in that universe, home sectors 11/22/33
 *   • each player gets a fully loaded Corporate FlagShip (max drones,
 *     shields, holds, cargo, and the max of every hardware item) in their
 *     home sector
 *   • 50,000,000 credits each
 *   • home sector: 100 sector drones, 10 proximity + 10 seeker mines (owned
 *     by that player); planet named after the player with 1000 colos per
 *     commodity bucket
 *   • 10 sector drones owned by the player in every sector warp-adjacent to
 *     their home sector
 *
 * Run with `pnpm db:addTestData1` (which is `node --env-file=.env
 * ./scripts/addTestData1.js` under the hood). Assumes the schema is up to
 * date — `pnpm db:reseed` immediately before is the canonical flow.
 */

import { pool } from '../dist/db/pool.js';
import { connectDB } from '../dist/db/schema.js';
import { generateUniverse } from '../dist/bigbang/index.js';
import {
    insertUniverseFull,
    getTemplateIdByName,
    snapshotTemplateForUniverse,
    getEarthStartingColonistsForUniverse,
} from '../dist/db/queries/universe.js';
import { insertSector, insertWarp, getStarbaseSectorNumber } from '../dist/db/queries/sector.js';
import { insertGeneratedPort, upsertSpecialPort } from '../dist/db/queries/port.js';
import { insertUnownedPlanet, setEarthColonists } from '../dist/db/queries/planet.js';
import { createUser } from '../dist/db/queries/user.js';
import { insertPlayer, setPlayerShipId } from '../dist/db/queries/player.js';
import { insertSectorDrones } from '../dist/db/queries/drones.js';
import { hashPassword } from '../dist/auth/password.js';
import { invalidateGraphCache } from '../dist/state/graph-cache.js';

const PLAYERS = [
    { name: '1', email: '1@1.1', password: '1', homeSector: 11 },
    { name: '2', email: '2@2.2', password: '2', homeSector: 22 },
    { name: '3', email: '3@3.3', password: '3', homeSector: 33 },
];

const CREDITS = 50_000_000;
const HOME_DRONES = 100;
const HOME_MINES_EACH = 10;
const ADJACENT_DRONES = 10;
const COLOS_PER_BUCKET = 1000;
const SHIP_TYPE_NAME = 'Corporate FlagShip';

async function main() {
    await connectDB();
    const client = await pool.connect();
    let universeId;
    try {
        await client.query('BEGIN');

        // ── 1. universe "test" with 1000 sectors ────────────────────────
        const result = generateUniverse({ sectors: 1000 });
        const templateId = await getTemplateIdByName('stock', client);
        universeId = await insertUniverseFull(
            'test',
            result.seed,
            templateId,
            client,
            result.topology,
        );
        await snapshotTemplateForUniverse(universeId, 'stock', client);

        const sectorIdMap = new Map();
        for (const s of result.sectors) {
            const id = await insertSector(universeId, s.id, s.name, client, s.x, s.y);
            sectorIdMap.set(s.id, id);
        }
        for (const w of result.warps) {
            await insertWarp(sectorIdMap.get(w.from), sectorIdMap.get(w.to), client);
        }
        for (const p of result.ports) {
            await insertGeneratedPort(
                sectorIdMap.get(p.sector),
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
        const sector1Id = sectorIdMap.get(1);
        await upsertSpecialPort(sector1Id, 0, client);
        const starbaseSectorNumber = await getStarbaseSectorNumber(universeId, client);
        if (starbaseSectorNumber !== null) {
            const sbDbId = sectorIdMap.get(starbaseSectorNumber);
            if (sbDbId !== undefined) await upsertSpecialPort(sbDbId, 9, client);
        }
        for (const p of result.planets) {
            const sDbId = sectorIdMap.get(p.sector);
            if (sDbId !== undefined) await insertUnownedPlanet(sDbId, p.name, p.type, client);
        }
        const earthCol = await getEarthStartingColonistsForUniverse(universeId, client);
        await setEarthColonists(sector1Id, earthCol, client);

        // ── 2. Look up Corporate FlagShip + its max hardware loadout ────
        const shipTypeRes = await client.query(
            `SELECT id, max_drones, max_shields, max_holds, turns_per_warp
             FROM ship_types WHERE name = $1`,
            [SHIP_TYPE_NAME],
        );
        if (shipTypeRes.rows.length === 0) {
            throw new Error(`ship_type ${SHIP_TYPE_NAME} not found — was the DB seeded?`);
        }
        const shipType = shipTypeRes.rows[0];

        const hwLoadoutRes = await client.query(
            `SELECT sth.hardware_item_id, sth.max_quantity
             FROM ship_type_hardware sth
             WHERE sth.ship_type_id = $1 AND sth.max_quantity > 0`,
            [shipType.id],
        );
        const hwLoadout = hwLoadoutRes.rows;

        // ── 3. Per-player: user, player, ship, home loadout, adj drones ─
        for (const def of PLAYERS) {
            const homeSectorDbId = sectorIdMap.get(def.homeSector);
            if (homeSectorDbId === undefined) {
                throw new Error(`home sector ${def.homeSector} not in universe`);
            }

            const user = await createUser(
                def.email,
                hashPassword(def.password),
                'player',
                client,
            );

            const playerId = await insertPlayer(
                def.name,
                user.id,
                universeId,
                homeSectorDbId,
                CREDITS,
                0, // starting turns — script doesn't need to seed turns; grant-job will
                client,
            );

            // Fully loaded ship: max drones/shields/holds, cargo holds packed
            // with fuel (arbitrary pick — equal split would just be three
            // floor-divides), 0 colonists for now.
            const shipRes = await client.query(
                `INSERT INTO ships (
                    owner_id, ship_type_id, sector_id,
                    drones, shields, holds, turns_per_warp,
                    fuel, organics, equipment, colonists
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, 0)
                 RETURNING id`,
                [
                    playerId,
                    shipType.id,
                    homeSectorDbId,
                    shipType.max_drones,
                    shipType.max_shields,
                    shipType.max_holds,
                    shipType.turns_per_warp,
                    shipType.max_holds, // fuel = full cargo
                ],
            );
            const shipId = shipRes.rows[0].id;
            await setPlayerShipId(playerId, shipId, client);

            // Stuff every hardware item the ship type allows up to its cap.
            for (const hw of hwLoadout) {
                await client.query(
                    `INSERT INTO ship_hardware (ship_id, hardware_item_id, quantity)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (ship_id, hardware_item_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
                    [shipId, hw.hardware_item_id, hw.max_quantity],
                );
            }

            // Mark home sector visited so neighborhood / minimap behaves.
            await client.query(
                `INSERT INTO player_visited_sectors (player_id, sector_id)
                 VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [playerId, homeSectorDbId],
            );

            // Home-sector deployment: drones, mines, owned planet.
            await insertSectorDrones(homeSectorDbId, playerId, HOME_DRONES, client);
            for (const mineType of ['proximity', 'seeker']) {
                await client.query(
                    `INSERT INTO sector_mines (sector_id, mine_type, quantity, owner_player_id)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (sector_id, mine_type)
                     DO UPDATE SET quantity = sector_mines.quantity + EXCLUDED.quantity,
                                   owner_player_id = EXCLUDED.owner_player_id`,
                    [homeSectorDbId, mineType, HOME_MINES_EACH, playerId],
                );
            }
            await client.query(
                `INSERT INTO planets (
                    sector_id, name, type, owner_player_id,
                    colonists_fuel, colonists_organics, colonists_equipment, colonists_drones
                 ) VALUES ($1, $2, 'Terran', $3, $4, $4, $4, $4)`,
                [homeSectorDbId, def.name, playerId, COLOS_PER_BUCKET],
            );

            // Adjacent sectors: 10 sector drones each. Two-way warps are
            // common but not universal; iterate every outgoing edge.
            const adjRes = await client.query(
                `SELECT DISTINCT to_sector_id FROM warps WHERE from_sector_id = $1`,
                [homeSectorDbId],
            );
            for (const row of adjRes.rows) {
                await insertSectorDrones(row.to_sector_id, playerId, ADJACENT_DRONES, client);
            }

            console.log(
                `  player "${def.name}" (user ${user.id}, player ${playerId}) seeded at sector ${def.homeSector}`,
            );
        }

        await client.query('COMMIT');
        invalidateGraphCache(universeId);
        console.log(`done — universe id ${universeId} ("test"), ${result.sectors.length} sectors`);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('addTestData1 failed:', err);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

void main();
