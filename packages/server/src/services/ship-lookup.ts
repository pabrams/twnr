import { getPlayerShipFull } from '../db/queries/ship.js';
import { getShipHardwareQuantities, getShipTypeHardwareMax } from '../db/queries/hardware.js';

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
