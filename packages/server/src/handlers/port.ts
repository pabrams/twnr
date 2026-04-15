import { ServerMsgType } from '@twnr/shared';
import {
    players,
    sendEnvelope,
    getPlayerUniverseId,
    PORT_CLASS_ACTIONS,
    portName,
    buildSectorDisplayData,
    setPlayerMenu,
} from '../game-state.js';
import { pool } from '../db/index.js';
import { setDocked, getCurrentSector } from '../db/queries/player.js';
import { checkAndDeductTurns } from '../turn-logic.js';

export async function handlePortInfo(playerId: number, sectorId: number): Promise<void> {
    if (!Number.isInteger(sectorId) || sectorId <= 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid sector ID' });
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const portRes = await pool.query(
        `SELECT s.sector_number as sector_id, p.class, p.fuel, p.fuel_max, p.fuel_price, p.organics, p.org_max, p.org_price, p.equipment, p.equ_max, p.equ_price
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
        portName: portName(sectorId),
        class: p.class,
        fuel: p.fuel,
        fuelMax: p.fuel_max,
        fuelPrice: p.fuel_price,
        organics: p.organics,
        orgMax: p.org_max,
        orgPrice: p.org_price,
        equipment: p.equipment,
        equMax: p.equ_max,
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

    const [portRes, cargoRes] = await Promise.all([
        pool.query(
            `SELECT p.class, p.fuel, p.fuel_max, p.fuel_price, p.organics, p.org_max, p.org_price, p.equipment, p.equ_max, p.equ_price
             FROM ports p JOIN sectors s ON p.sector_id = s.id
             WHERE s.sector_number = $1 AND s.universe_id = $2`,
            [player.sector, player.universeId],
        ),
        pool.query(
            `SELECT s.fuel, s.organics, s.equipment, s.colonists, s.holds as cargo_limit, pl.credits
             FROM players pl JOIN ships s ON pl.ship_id = s.id
             WHERE pl.id = $1`,
            [playerId],
        ),
    ]);
    if (portRes.rows.length === 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'No port in this sector' });
        return;
    }

    player.docked = true;
    await setDocked(playerId, true);

    const p = portRes.rows[0];
    const cargo = cargoRes.rows[0];
    const used =
        (cargo?.fuel ?? 0) +
        (cargo?.organics ?? 0) +
        (cargo?.equipment ?? 0) +
        (cargo?.colonists ?? 0);
    const emptyHolds = Math.max(0, (cargo?.cargo_limit ?? 0) - used);

    await setPlayerMenu(playerId, p.class === 0 ? 'class0' : 'docked');
    sendEnvelope(playerId, {
        type: ServerMsgType.DockResult,
        docked: true,
        port: {
            type: ServerMsgType.PortInfoResult,
            sectorId: player.sector,
            portName: portName(player.sector),
            class: p.class,
            fuel: p.fuel,
            fuelMax: p.fuel_max,
            fuelPrice: p.fuel_price,
            organics: p.organics,
            orgMax: p.org_max,
            orgPrice: p.org_price,
            equipment: p.equipment,
            equMax: p.equ_max,
            equPrice: p.equ_price,
        },
        credits: cargo?.credits ?? 0,
        cargo: {
            fuel: cargo?.fuel ?? 0,
            organics: cargo?.organics ?? 0,
            equipment: cargo?.equipment ?? 0,
            colonists: cargo?.colonists ?? 0,
        },
        emptyHolds,
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
    await setDocked(playerId, false);
    await setPlayerMenu(playerId, 'sector');

    const sectorData = await buildSectorDisplayData(playerId);
    if (!sectorData) return;
    sendEnvelope(playerId, {
        type: ServerMsgType.UndockResult,
        outcome: 'success',
        ...sectorData,
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

        const currentSector = await getCurrentSector(playerId, client);
        if (currentSector === undefined) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }

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
            const turnResult = await checkAndDeductTurns(playerId, universeId, 1, client);
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
            const usedAfterBuy = cargo.fuel + cargo.organics + cargo.equipment + cargo.colonists;
            sendEnvelope(playerId, {
                type: ServerMsgType.PortTransactionResult,
                credits: cargo.credits,
                cargo: {
                    fuel: cargo.fuel,
                    organics: cargo.organics,
                    equipment: cargo.equipment,
                    colonists: cargo.colonists,
                },
                emptyHolds: Math.max(0, cargo.cargo_limit - usedAfterBuy),
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
            if (port[good] < qty) {
                await client.query('ROLLBACK');
                sendEnvelope(playerId, {
                    type: ServerMsgType.Error,
                    message: 'Port cannot buy that many',
                });
                return;
            }

            await client.query(`UPDATE ports SET ${col} = ${col} - $1 WHERE id = $2`, [
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
            const usedAfterSell = cargo.fuel + cargo.organics + cargo.equipment + cargo.colonists;
            sendEnvelope(playerId, {
                type: ServerMsgType.PortTransactionResult,
                credits: cargo.credits,
                cargo: {
                    fuel: cargo.fuel,
                    organics: cargo.organics,
                    equipment: cargo.equipment,
                    colonists: cargo.colonists,
                },
                emptyHolds: Math.max(0, cargo.cargo_limit - usedAfterSell),
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
    await setPlayerMenu(playerId, 'starbase');

    // Fetch hardware prices from the universe's edit (or fall back to defaults)
    const priceRes = await pool.query(
        `SELECT hi.name, hi.label, COALESCE(hp.price, hi.default_price) as price
         FROM hardware_item hi
         LEFT JOIN hardware_price hp ON hp.hardware_item_id = hi.id
           AND hp.edit_id = (SELECT edit_id FROM universes WHERE id = $1)
         ORDER BY hi.id`,
        [player.universeId],
    );
    sendEnvelope(playerId, {
        type: ServerMsgType.DockStarbaseResult,
        prices: priceRes.rows.map((r: any) => ({ name: r.name, label: r.label, price: r.price })),
    });
}

export async function handleLeaveStarbase(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (!player.at_starbase) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not at Starbase' });
        return;
    }

    player.at_starbase = false;
    await setPlayerMenu(playerId, 'sector');

    const sectorData = await buildSectorDisplayData(playerId);
    if (!sectorData) return;
    sendEnvelope(playerId, {
        type: ServerMsgType.LeaveStarbaseResult,
        ...sectorData,
    });
}
