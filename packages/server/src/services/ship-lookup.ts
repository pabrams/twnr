import { getPlayerShipFull } from '../db/queries/ship.js';
import { getShipHardwareQuantities, getShipTypeHardwareMax } from '../db/queries/hardware.js';

/**
 * Get the player's current ship denormalised with hardware maps:
 *
 *   - `hardware`: { name → current quantity } for everything installed
 *   - `hardware_max`: { name → cap } for everything the ship type allows
 *
 * Returns null if the player has no ship. Centralised here so handlers
 * don't have to remember to pull and zip three queries every time.
 */
export async function getPlayerShip(playerId: number) {
    const ship = await getPlayerShipFull(playerId);
    if (!ship) return null;

    const hwRows = await getShipHardwareQuantities(ship.id as number);
    (ship as Record<string, unknown>).hardware = Object.fromEntries(
        hwRows.map((r) => [r.name, r.quantity]),
    );

    const hwMaxRows = await getShipTypeHardwareMax(
        ship.universe_id as number,
        ship.ship_type_slug as string,
    );
    (ship as Record<string, unknown>).hardware_max = Object.fromEntries(
        hwMaxRows.map((r) => [r.name, r.max_quantity]),
    );

    return ship;
}
