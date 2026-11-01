import { type DensityScanEntry, type SectorDisplayData } from '@twnr/shared';
import { requireOnlinePlayer } from '../state/players.js';
import { getDensityScanRows, getOutWarpSectorNumbers } from '../db/queries/scan.js';
import { getShipHardwareQuantityByName } from '../db/queries/hardware.js';
import { buildSectorDisplayData } from '../services/sector-display.js';
import { checkAndDeductTurns } from '../turn-logic.js';
import { notifyTurnChange } from '../services/notify.js';
import { type CommandResult, commandRefusal } from './command.js';

const W_PORT = 100;
const W_SHIP = 40;
const W_PLANET = 600;
const W_DRONE = 5;
const W_PROXIMITY = 10;
const W_LIMPET = 2;
const W_BEACON = 1;

/** Passive — no turn cost. */
export async function serveDensityScan(playerId: number): Promise<CommandResult<'DensityScan'>> {
    const player = requireOnlinePlayer(playerId);
    if (player.docked || player.at_starbase) {
        return commandRefusal('docked');
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

    return { outcome: 'ok', entries, hasVisualScanner: scannerQty > 0 };
}

export async function serveVisualScan(playerId: number): Promise<CommandResult<'VisualScan'>> {
    const player = requireOnlinePlayer(playerId);
    if (player.docked || player.at_starbase) {
        return commandRefusal('docked');
    }

    const scannerQty = await getShipHardwareQuantityByName(playerId, 'visual_scanner');
    if (scannerQty <= 0) {
        return commandRefusal('noVisualScanner');
    }

    const turnResult = await checkAndDeductTurns(playerId, player.universeId, 1);
    if (!turnResult.allowed) {
        return commandRefusal('insufficientTurns');
    }
    if (turnResult.turnsUsed) {
        notifyTurnChange(playerId, turnResult.turnsUsed, 'visual scan');
    }

    const outWarps = await getOutWarpSectorNumbers(player.sectorId);
    const sectors: SectorDisplayData[] = [];
    for (const sectorNumber of outWarps) {
        const data = await buildSectorDisplayData(playerId, sectorNumber);
        if (data) sectors.push(data);
    }

    return { outcome: 'ok', sectors };
}
