import { ServerMsgType } from '@twnr/shared';
import {
    players,
    sendEnvelope,
    getPlayerUniverseId,
    PORT_CLASS_ACTIONS,
    getGraph,
    getPortForSector,
    getVisitedSectors,
    getSectorDrones,
    setPlayerMenu,
} from '../game-state.js';
import { pool } from '../db/index.js';
import { checkAndDeductTurns } from '../turn-logic.js';

export async function handlePortInfo(playerId: number, sectorId: number): Promise<void> {
    if (!Number.isInteger(sectorId) || sectorId <= 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid sector ID' });
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const portRes = await pool.query(
        `SELECT s.sector_number as sector_id, p.class, p.fuel, p.fuel_price, p.organics, p.org_price, p.equipment, p.equ_price
         FROM ports p JOIN sectors s ON p.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2`,
        [sectorId, universeId],
    );
    if (portRes.rows.length === 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'No port in this sector' });
        return;
    }

    const p = portRes.rows[0];
    sendEnvelope(playerId, {
        type: ServerMsgType.PortInfoResult,
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

export async function handleDock(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.docked) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Already docked' });
        return;
    }

    if (player.pendingEncounter) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Resolve drone encounter first',
        });
        return;
    }

    const portRes = await pool.query(
        `SELECT p.class, p.fuel, p.fuel_price, p.organics, p.org_price, p.equipment, p.equ_price
         FROM ports p JOIN sectors s ON p.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2`,
        [player.sector, player.universeId],
    );
    if (portRes.rows.length === 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'No port in this sector' });
        return;
    }

    player.docked = true;
    await pool.query('UPDATE players SET docked = TRUE WHERE id = $1', [playerId]);

    const p = portRes.rows[0];
    await setPlayerMenu(playerId, p.class === 0 ? 'class0' : 'docked');
    sendEnvelope(playerId, {
        type: ServerMsgType.DockResult,
        docked: true,
        port: {
            type: ServerMsgType.PortInfoResult,
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

export async function handleUndock(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (!player.docked) {
        sendEnvelope(playerId, {
            type: ServerMsgType.UndockResult,
            outcome: 'error',
            message: 'Not docked',
        });
        return;
    }

    player.docked = false;
    await pool.query('UPDATE players SET docked = FALSE WHERE id = $1', [playerId]);
    await setPlayerMenu(playerId, 'sector');

    const currentSector = player.sector;
    const universeId = player.universeId;

    const [warps, port, visitedSectors, sectorDrones, planetsRes] = await Promise.all([
        getGraph(universeId),
        getPortForSector(currentSector, universeId),
        getVisitedSectors(playerId),
        getSectorDrones(currentSector, universeId),
        pool.query(
            `SELECT pl.id, pl.name, pl.type FROM planets pl
             JOIN sectors s ON pl.sector_id = s.id
             WHERE s.sector_number = $1 AND s.universe_id = $2 ORDER BY pl.id`,
            [currentSector, universeId],
        ),
    ]);
    const planets = planetsRes.rows;
    const displayWarps = warps[currentSector] || [];
    const playersInSector = Object.entries(players)
        .filter(
            ([id, p]) =>
                p.sector === currentSector &&
                p.universeId === universeId &&
                !p.docked &&
                Number(id) !== playerId,
        )
        .map(([id, p]) => ({ id: Number(id), name: p.name }));

    sendEnvelope(playerId, {
        type: ServerMsgType.UndockResult,
        outcome: 'success',
        sector: currentSector,
        warps: displayWarps,
        players: playersInSector,
        port,
        visitedSectors,
        sectorDrones,
        planets,
    });
}

export async function handlePortTransaction(
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
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid good' });
        return;
    }

    if (!['buy', 'sell'].includes(action)) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid action' });
        return;
    }

    const qty = Number.isInteger(quantity) ? quantity : parseInt(String(quantity), 10);
    if (isNaN(qty) || qty <= 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid quantity' });
        return;
    }

    const player = players[playerId];
    if (!player) return;
    const universeId = player.universeId;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const pRes = await client.query(
            'SELECT s.sector_number as current_sector FROM players p JOIN sectors s ON p.current_sector_id = s.id WHERE p.id = $1',
            [playerId],
        );
        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }
        const currentSector = pRes.rows[0].current_sector;

        const portRes = await client.query(
            `SELECT p.id as port_id, p.class, p.fuel, p.fuel_price, p.organics, p.org_price, p.equipment, p.equ_price
             FROM ports p JOIN sectors s ON p.sector_id = s.id
             WHERE s.sector_number = $1 AND s.universe_id = $2 FOR UPDATE OF p`,
            [currentSector, universeId],
        );
        if (portRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: 'No port in this sector',
            });
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
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: 'Port does not trade this commodity',
            });
            return;
        }

        const price: number = port[priceColMap[good]];

        const cargoRes = await client.query(
            `
            SELECT s.fuel, s.organics, s.equipment, s.colonists, p.credits, s.holds as cargo_limit
            FROM players p
            JOIN ships s ON p.ship_id = s.id
            WHERE p.id = $1 FOR UPDATE OF s, p
        `,
            [playerId],
        );
        if (cargoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }

        const cargo = cargoRes.rows[0];

        if (action === 'buy') {
            // Check turns for buying
            const turnResult = await checkAndDeductTurns(playerId, universeId, 1);
            if (!turnResult.allowed) {
                await client.query('ROLLBACK');
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: 'Insufficient turns',
                });
                return;
            }

            const cost = qty * price;
            if (cargo.credits < cost) {
                await client.query('ROLLBACK');
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: 'Insufficient credits',
                });
                return;
            }
            if (port[good] < qty) {
                await client.query('ROLLBACK');
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: 'Insufficient port inventory',
                });
                return;
            }
            if (
                cargo.fuel + cargo.organics + cargo.equipment + cargo.colonists + qty >
                cargo.cargo_limit
            ) {
                await client.query('ROLLBACK');
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: 'Insufficient cargo holds',
                });
                return;
            }

            await client.query(`UPDATE ports SET ${col} = ${col} - $1 WHERE id = $2`, [
                qty,
                port.port_id,
            ]);
            await client.query(
                `UPDATE ships SET ${col} = ${col} + $1 WHERE id = (SELECT ship_id FROM players WHERE id = $2)`,
                [qty, playerId],
            );
            await client.query(`UPDATE players SET credits = credits - $1 WHERE id = $2`, [
                cost,
                playerId,
            ]);
            await client.query('COMMIT');

            cargo[good] += qty;
            cargo.credits -= cost;
            sendEnvelope(playerId, {
                type: ServerMsgType.PortTransactionResult,
                credits: cargo.credits,
                cargo: {
                    fuel: cargo.fuel,
                    organics: cargo.organics,
                    equipment: cargo.equipment,
                    colonists: cargo.colonists,
                },
                turnsUsed: turnResult.turnsUsed,
            });
        } else {
            const revenue = qty * price;
            if (cargo[good] < qty) {
                await client.query('ROLLBACK');
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: 'Insufficient cargo',
                });
                return;
            }

            await client.query(`UPDATE ports SET ${col} = ${col} + $1 WHERE id = $2`, [
                qty,
                port.port_id,
            ]);
            await client.query(
                `UPDATE ships SET ${col} = ${col} - $1 WHERE id = (SELECT ship_id FROM players WHERE id = $2)`,
                [qty, playerId],
            );
            await client.query(`UPDATE players SET credits = credits + $1 WHERE id = $2`, [
                revenue,
                playerId,
            ]);
            await client.query('COMMIT');

            cargo[good] -= qty;
            cargo.credits += revenue;
            sendEnvelope(playerId, {
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
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

export async function handleDockStarbase(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.pendingEncounter) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Resolve drone encounter first',
        });
        return;
    }

    const portRes = await pool.query(
        `SELECT p.class FROM ports p JOIN sectors s ON p.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2`,
        [player.sector, player.universeId],
    );
    if (portRes.rows.length === 0 || portRes.rows[0].class !== 9) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: 'Starbase not found in this sector',
        });
        return;
    }

    player.at_starbase = true;

    sendEnvelope(playerId, { type: ServerMsgType.DockStarbaseResult });
}

export async function handleLeaveStarbase(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (!player.at_starbase) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not at Starbase' });
        return;
    }

    player.at_starbase = false;

    const currentSector = player.sector;
    const universeId = player.universeId;

    const [warps, port, visitedSectors, sectorDrones, planetsRes] = await Promise.all([
        getGraph(universeId),
        getPortForSector(currentSector, universeId),
        getVisitedSectors(playerId),
        getSectorDrones(currentSector, universeId),
        pool.query(
            `SELECT pl.id, pl.name, pl.type FROM planets pl
             JOIN sectors s ON pl.sector_id = s.id
             WHERE s.sector_number = $1 AND s.universe_id = $2 ORDER BY pl.id`,
            [currentSector, universeId],
        ),
    ]);
    const displayWarps = warps[currentSector] || [];
    const playersInSector = Object.entries(players)
        .filter(
            ([id, p]) =>
                p.sector === currentSector &&
                p.universeId === universeId &&
                !p.docked &&
                Number(id) !== playerId,
        )
        .map(([id, p]) => ({ id: Number(id), name: p.name }));

    sendEnvelope(playerId, {
        type: ServerMsgType.LeaveStarbaseResult,
        sector: currentSector,
        warps: displayWarps,
        players: playersInSector,
        port,
        visitedSectors,
        sectorDrones,
        planets: planetsRes.rows,
    });
}

export async function handleBuyPlanetBusters(playerId: number, quantity: number): Promise<void> {
    const qty = Number.isInteger(quantity) ? quantity : 0;
    if (qty <= 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid quantity' });
        return;
    }

    const player = players[playerId];
    if (!player) return;

    if (!player.at_starbase) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not at Starbase' });
        return;
    }

    const cost = qty * 20000;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const shipRes = await client.query(
            `SELECT s.id as ship_id, st.name as ship_name, s.planet_busters, st.max_planet_busters
             FROM ships s JOIN ship_types st ON s.ship_type_id = st.id
             WHERE s.id = (SELECT ship_id FROM players WHERE id = $1) FOR UPDATE OF s`,
            [playerId],
        );
        if (shipRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Ship not found' });
            return;
        }

        const cargoRes = await client.query(
            'SELECT credits FROM players WHERE id = $1 FOR UPDATE',
            [playerId],
        );
        if (cargoRes.rows.length === 0 || cargoRes.rows[0].credits < cost) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Insufficient credits' });
            return;
        }

        const maxPlanetBusters = shipRes.rows[0].max_planet_busters || 0;

        if (shipRes.rows[0].planet_busters + qty > maxPlanetBusters) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: 'Cannot hold that many Planet Busters',
            });
            return;
        }

        await client.query('UPDATE players SET credits = credits - $1 WHERE id = $2', [
            cost,
            playerId,
        ]);
        await client.query('UPDATE ships SET planet_busters = planet_busters + $1 WHERE id = $2', [
            qty,
            shipRes.rows[0].ship_id,
        ]);
        await client.query('COMMIT');

        sendEnvelope(playerId, {
            type: ServerMsgType.BuyPlanetBustersResult,
            quantity: qty,
            totalOnShip: shipRes.rows[0].planet_busters + qty,
            credits: cargoRes.rows[0].credits - cost,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Buy hardware error', err);
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

export async function handleBuyTerraformDevices(playerId: number, quantity: number): Promise<void> {
    const qty = Number.isInteger(quantity) ? quantity : 0;
    if (qty <= 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid quantity' });
        return;
    }

    const player = players[playerId];
    if (!player) return;

    if (!player.at_starbase) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not at Starbase' });
        return;
    }

    const cost = qty * 5000;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const shipRes = await client.query(
            `SELECT s.id as ship_id, st.name as ship_name, s.terraform_devices, st.max_terraform_devices
             FROM ships s JOIN ship_types st ON s.ship_type_id = st.id
             WHERE s.id = (SELECT ship_id FROM players WHERE id = $1) FOR UPDATE OF s`,
            [playerId],
        );
        if (shipRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Ship not found' });
            return;
        }

        const cargoRes = await client.query(
            'SELECT credits FROM players WHERE id = $1 FOR UPDATE',
            [playerId],
        );
        if (cargoRes.rows.length === 0 || cargoRes.rows[0].credits < cost) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Insufficient credits' });
            return;
        }

        const maxTerraformDevices = shipRes.rows[0].max_terraform_devices || 0;

        if (shipRes.rows[0].terraform_devices + qty > maxTerraformDevices) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: 'Cannot hold that many Terraform Devices',
            });
            return;
        }

        await client.query('UPDATE players SET credits = credits - $1 WHERE id = $2', [
            cost,
            playerId,
        ]);
        await client.query(
            'UPDATE ships SET terraform_devices = terraform_devices + $1 WHERE id = $2',
            [qty, shipRes.rows[0].ship_id],
        );
        await client.query('COMMIT');

        sendEnvelope(playerId, {
            type: ServerMsgType.BuyTerraformDevicesResult,
            quantity: qty,
            totalOnShip: shipRes.rows[0].terraform_devices + qty,
            credits: cargoRes.rows[0].credits - cost,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Buy hardware error', err);
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}
