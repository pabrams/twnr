import { WebSocket } from 'ws';
import { ServerMsgType } from '@twnr/shared';
import { players, send, getPlayerUniverseId, PORT_CLASS_ACTIONS } from '../game-state.js';
import { pool } from '../db/index.js';

export async function handlePortInfo(
    ws: WebSocket,
    playerId: number,
    sectorId: number,
): Promise<void> {
    if (!Number.isInteger(sectorId) || sectorId <= 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid sector ID' });
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const portRes = await pool.query(
        'SELECT sector_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price FROM ports WHERE sector_id = $1 AND universe_id = $2',
        [sectorId, universeId],
    );
    if (portRes.rows.length === 0) {
        send(ws, { type: ServerMsgType.Error, message: 'No port in this sector' });
        return;
    }

    const p = portRes.rows[0];
    send(ws, {
        type: ServerMsgType.PortInfo,
        sectorId: p.sector_id,
        class: p.class,
        fuel: p.fuel,
        fuelPrice: p.fuel_price,
        organics: p.organics,
        orgPrice: p.org_price,
        equipment: p.equipment,
        equPrice: p.equ_price,
    });
}

export async function handleDock(ws: WebSocket, playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.docked) {
        send(ws, { type: ServerMsgType.Error, message: 'Already docked' });
        return;
    }

    if (player.pendingEncounter) {
        send(ws, { type: ServerMsgType.Error, message: 'Resolve fighter encounter first' });
        return;
    }

    const portRes = await pool.query(
        'SELECT class, fuel, fuel_price, organics, org_price, equipment, equ_price FROM ports WHERE sector_id = $1 AND universe_id = $2',
        [player.sector, player.universeId],
    );
    if (portRes.rows.length === 0) {
        send(ws, { type: ServerMsgType.Error, message: 'No port in this sector' });
        return;
    }

    player.docked = true;
    await pool.query('UPDATE players SET docked = TRUE WHERE id = $1', [playerId]);

    const p = portRes.rows[0];
    send(ws, {
        type: ServerMsgType.DockResult,
        docked: true,
        port: {
            type: ServerMsgType.PortInfo,
            sectorId: player.sector,
            class: p.class,
            fuel: p.fuel,
            fuelPrice: p.fuel_price,
            organics: p.organics,
            orgPrice: p.org_price,
            equipment: p.equipment,
            equPrice: p.equ_price,
        },
    });
}

export async function handleUndock(ws: WebSocket, playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (!player.docked) {
        send(ws, { type: ServerMsgType.Error, message: 'Not docked' });
        return;
    }

    player.docked = false;
    await pool.query('UPDATE players SET docked = FALSE WHERE id = $1', [playerId]);

    send(ws, { type: ServerMsgType.DockResult, docked: false });
}

export async function handlePortTransaction(
    ws: WebSocket,
    playerId: number,
    good: string,
    quantity: number,
    action: string,
): Promise<void> {
    const VALID_GOODS: Record<string, string> = {
        fuel: 'fuel',
        organics: 'organics',
        equipment: 'equipment',
    };
    const col = VALID_GOODS[good];
    if (!col) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid good' });
        return;
    }

    if (!['buy', 'sell'].includes(action)) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid action' });
        return;
    }

    const qty = Number.isInteger(quantity) ? quantity : parseInt(String(quantity), 10);
    if (isNaN(qty) || qty <= 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid quantity' });
        return;
    }

    const player = players[playerId];
    if (!player) return;
    const universeId = player.universeId;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const pRes = await client.query('SELECT current_sector FROM players WHERE id = $1', [
            playerId,
        ]);
        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }
        const currentSector = pRes.rows[0].current_sector;

        const portRes = await client.query(
            'SELECT class, fuel, fuel_price, organics, org_price, equipment, equ_price FROM ports WHERE sector_id = $1 AND universe_id = $2 FOR UPDATE',
            [currentSector, universeId],
        );
        if (portRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'No port in this sector' });
            return;
        }

        const port = portRes.rows[0];

        const priceColMap: Record<string, string> = {
            fuel: 'fuel_price',
            organics: 'org_price',
            equipment: 'equ_price',
        };
        const portActions = PORT_CLASS_ACTIONS[port.class];
        if (
            !portActions ||
            (action === 'buy' && portActions[good] !== 'S') ||
            (action === 'sell' && portActions[good] !== 'B')
        ) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Port does not trade this commodity' });
            return;
        }

        const price: number = port[priceColMap[good]];

        const cargoRes = await client.query(
            `
            SELECT sc.fuel, sc.organics, sc.equipment, sc.colonists, sc.credits, ps.cargo_limit
            FROM ship_cargo sc
            JOIN player_ships ps ON sc.player_id = ps.player_id
            WHERE sc.player_id = $1 FOR UPDATE
        `,
            [playerId],
        );
        if (cargoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }

        const cargo = cargoRes.rows[0];

        if (action === 'buy') {
            const cost = qty * price;
            if (cargo.credits < cost) {
                await client.query('ROLLBACK');
                send(ws, { type: ServerMsgType.Error, message: 'Insufficient credits' });
                return;
            }
            if (port[good] < qty) {
                await client.query('ROLLBACK');
                send(ws, { type: ServerMsgType.Error, message: 'Insufficient port inventory' });
                return;
            }
            if (
                cargo.fuel + cargo.organics + cargo.equipment + cargo.colonists + qty >
                cargo.cargo_limit
            ) {
                await client.query('ROLLBACK');
                send(ws, { type: ServerMsgType.Error, message: 'Insufficient cargo holds' });
                return;
            }

            await client.query(
                `UPDATE ports SET ${col} = ${col} - $1 WHERE sector_id = $2 AND universe_id = $3`,
                [qty, currentSector, universeId],
            );
            await client.query(
                `UPDATE ship_cargo SET ${col} = ${col} + $1, credits = credits - $2 WHERE player_id = $3`,
                [qty, cost, playerId],
            );
            await client.query('COMMIT');

            cargo[good] += qty;
            cargo.credits -= cost;
            send(ws, {
                type: ServerMsgType.PortTransactionResult,
                credits: cargo.credits,
                cargo: {
                    fuel: cargo.fuel,
                    organics: cargo.organics,
                    equipment: cargo.equipment,
                    colonists: cargo.colonists,
                },
            });
        } else {
            const revenue = qty * price;
            if (cargo[good] < qty) {
                await client.query('ROLLBACK');
                send(ws, { type: ServerMsgType.Error, message: 'Insufficient cargo' });
                return;
            }

            await client.query(
                `UPDATE ports SET ${col} = ${col} + $1 WHERE sector_id = $2 AND universe_id = $3`,
                [qty, currentSector, universeId],
            );
            await client.query(
                `UPDATE ship_cargo SET ${col} = ${col} - $1, credits = credits + $2 WHERE player_id = $3`,
                [qty, revenue, playerId],
            );
            await client.query('COMMIT');

            cargo[good] -= qty;
            cargo.credits += revenue;
            send(ws, {
                type: ServerMsgType.PortTransactionResult,
                credits: cargo.credits,
                cargo: {
                    fuel: cargo.fuel,
                    organics: cargo.organics,
                    equipment: cargo.equipment,
                    colonists: cargo.colonists,
                },
            });
        }
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Trade error', err);
        send(ws, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

export async function handleDockStardock(ws: WebSocket, playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.pendingEncounter) {
        send(ws, { type: ServerMsgType.Error, message: 'Resolve fighter encounter first' });
        return;
    }

    const portRes = await pool.query(
        'SELECT class FROM ports WHERE sector_id = $1 AND universe_id = $2',
        [player.sector, player.universeId],
    );
    if (portRes.rows.length === 0 || portRes.rows[0].class !== 9) {
        send(ws, { type: ServerMsgType.Error, message: 'Stardock not found in this sector' });
        return;
    }

    player.at_stardock = true;

    send(ws, { type: ServerMsgType.StardockMenu });
}

export async function handleLeaveStardock(ws: WebSocket, playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (!player.at_stardock) {
        send(ws, { type: ServerMsgType.Error, message: 'Not at Stardock' });
        return;
    }

    player.at_stardock = false;

    import('./movement.js').then(({ handleSectorDisplay }) => {
        handleSectorDisplay(ws, playerId);
    });
}

export async function handleBuyPlanetBusters(
    ws: WebSocket,
    playerId: number,
    quantity: number,
): Promise<void> {
    const qty = Number.isInteger(quantity) ? quantity : 0;
    if (qty <= 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid quantity' });
        return;
    }

    const player = players[playerId];
    if (!player) return;

    if (!player.at_stardock) {
        send(ws, { type: ServerMsgType.Error, message: 'Not at Stardock' });
        return;
    }

    const cost = qty * 20000;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const shipRes = await client.query(
            'SELECT ship_name, planet_busters FROM player_ships WHERE player_id = $1 FOR UPDATE',
            [playerId],
        );
        if (shipRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Ship not found' });
            return;
        }

        const cargoRes = await client.query(
            'SELECT credits FROM ship_cargo WHERE player_id = $1 FOR UPDATE',
            [playerId],
        );
        if (cargoRes.rows.length === 0 || cargoRes.rows[0].credits < cost) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Insufficient credits' });
            return;
        }

        import('../ship-config.js').then(async ({ shipConfigs }) => {
            const config = shipConfigs[shipRes.rows[0].ship_name];
            const maxPlanetBusters = config?.maxPlanetBusters || 0;

            if (shipRes.rows[0].planet_busters + qty > maxPlanetBusters) {
                await client.query('ROLLBACK');
                send(ws, {
                    type: ServerMsgType.Error,
                    message: 'Cannot hold that many Planet Busters',
                });
                return;
            }

            await client.query(
                'UPDATE ship_cargo SET credits = credits - $1 WHERE player_id = $2',
                [cost, playerId],
            );
            await client.query(
                'UPDATE player_ships SET planet_busters = planet_busters + $1 WHERE player_id = $2',
                [qty, playerId],
            );
            await client.query('COMMIT');

            send(ws, {
                type: ServerMsgType.BuyHardwareResult,
                item: 'planet_busters',
                quantity: qty,
                totalOnShip: shipRes.rows[0].planet_busters + qty,
                credits: cargoRes.rows[0].credits - cost,
            });
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Buy hardware error', err);
        send(ws, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

export async function handleBuyTerraformDevices(
    ws: WebSocket,
    playerId: number,
    quantity: number,
): Promise<void> {
    const qty = Number.isInteger(quantity) ? quantity : 0;
    if (qty <= 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid quantity' });
        return;
    }

    const player = players[playerId];
    if (!player) return;

    if (!player.at_stardock) {
        send(ws, { type: ServerMsgType.Error, message: 'Not at Stardock' });
        return;
    }

    const cost = qty * 5000;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const shipRes = await client.query(
            'SELECT ship_name, terraform_devices FROM player_ships WHERE player_id = $1 FOR UPDATE',
            [playerId],
        );
        if (shipRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Ship not found' });
            return;
        }

        const cargoRes = await client.query(
            'SELECT credits FROM ship_cargo WHERE player_id = $1 FOR UPDATE',
            [playerId],
        );
        if (cargoRes.rows.length === 0 || cargoRes.rows[0].credits < cost) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Insufficient credits' });
            return;
        }

        import('../ship-config.js').then(async ({ shipConfigs }) => {
            const config = shipConfigs[shipRes.rows[0].ship_name];
            const maxTerraformDevices = config?.maxTerraformDevices || 0;

            if (shipRes.rows[0].terraform_devices + qty > maxTerraformDevices) {
                await client.query('ROLLBACK');
                send(ws, {
                    type: ServerMsgType.Error,
                    message: 'Cannot hold that many Terraform Devices',
                });
                return;
            }

            await client.query(
                'UPDATE ship_cargo SET credits = credits - $1 WHERE player_id = $2',
                [cost, playerId],
            );
            await client.query(
                'UPDATE player_ships SET terraform_devices = terraform_devices + $1 WHERE player_id = $2',
                [qty, playerId],
            );
            await client.query('COMMIT');

            send(ws, {
                type: ServerMsgType.BuyHardwareResult,
                item: 'terraform_devices',
                quantity: qty,
                totalOnShip: shipRes.rows[0].terraform_devices + qty,
                credits: cargoRes.rows[0].credits - cost,
            });
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Buy hardware error', err);
        send(ws, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}
