import { ServerTag, type DensityScanEntry, type SectorDisplayData } from '@twnr/shared';
import { players } from '../state/players.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { getDensityScanRows, getOutWarpSectorNumbers } from '../db/queries/scan.js';
import { getShipHardwareQuantityByName } from '../db/queries/hardware.js';
import { buildSectorDisplayData } from '../services/sector-display.js';
import { checkAndDeductTurns } from '../turn-logic.js';

// Density-score weights — see `Long Range Scan` spec.
const W_PORT = 100;
const W_SHIP = 40;
const W_PLANET = 600;
const W_DRONE = 5;
const W_PROXIMITY = 10;
const W_LIMPET = 2;
const W_BEACON = 1;

/** Density scan — passive (no turn cost). Returns one entry per out-warp
 *  sector with aggregate weighted density, anomaly flag, and the warp
 *  count, plus a flag telling the client whether to offer the visual
 *  follow-up. */
export async function serveDensityScan(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;
    if (player.docked || player.at_starbase) {
        sendError(playerId, 'Cannot scan while docked');
        return;
    }

    const [rows, scannerQty] = await Promise.all([
        getDensityScanRows(player.sectorId, playerId),
        getShipHardwareQuantityByName(playerId, 'visual_scanner'),
    ]);

    const entries: DensityScanEntry[] = rows.map((r) => ({
        sector: r.sector_number,
        visited: r.visited,
        density:
            r.port_count * W_PORT +
            r.ship_count * W_SHIP +
            r.planet_count * W_PLANET +
            r.drone_qty * W_DRONE +
            r.prox_qty * W_PROXIMITY +
            r.limpet_qty * W_LIMPET +
            (r.has_beacon ? W_BEACON : 0),
        warps: r.warp_count,
        navHaz: 0,
        anom: r.limpet_qty > 0,
    }));

    sendEnvelope(playerId, {
        type: ServerTag.DensityScanResult,
        entries,
        hasVisualScanner: scannerQty > 0,
    });
}

/** Visual scan — costs one turn, returns a full sector display payload
 *  for each adjacent (out-warp) sector. Server rejects if the player
 *  doesn't actually have a visual scanner. */
export async function serveVisualScan(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;
    if (player.docked || player.at_starbase) {
        sendError(playerId, 'Cannot scan while docked');
        return;
    }

    const scannerQty = await getShipHardwareQuantityByName(playerId, 'visual_scanner');
    if (scannerQty <= 0) {
        sendError(playerId, 'You do not have a visual scanner.');
        return;
    }

    const turnResult = await checkAndDeductTurns(playerId, player.universeId, 1);
    if (!turnResult.allowed) {
        sendError(playerId, 'Insufficient turns');
        return;
    }

    const outWarps = await getOutWarpSectorNumbers(player.sectorId);
    const sectors: SectorDisplayData[] = [];
    for (const sectorNumber of outWarps) {
        const data = await buildSectorDisplayData(playerId, sectorNumber);
        if (data) sectors.push(data);
    }

    sendEnvelope(playerId, { type: ServerTag.VisualScanResult, sectors });
}
