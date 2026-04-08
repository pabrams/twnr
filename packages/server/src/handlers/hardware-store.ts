import { ServerMsgType } from '@twnr/shared';
import { players, sendEnvelope } from '../game-state.js';
import { pool } from '../db/index.js';

/** Generic helper for buying stackable hardware (quantity-based items). */
async function buyStackableHardware(
    playerId: number,
    quantity: number,
    opts: {
        shipColumn: string;
        maxColumn: string;
        unitPrice: number;
        itemName: string;
        resultType: string;
        resultExtra?: Record<string, any>;
    },
): Promise<void> {
    const qty = Number.isInteger(quantity) ? quantity : 0;
    if (qty <= 0) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid quantity' });
        return;
    }

    const player = players[playerId];
    if (!player?.at_starbase) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not at Starbase' });
        return;
    }

    const cost = qty * opts.unitPrice;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const shipRes = await client.query(
            `SELECT s.id as ship_id, s.${opts.shipColumn} as current_qty, st.${opts.maxColumn} as max_qty
             FROM ships s JOIN ship_types st ON s.ship_type_id = st.id
             WHERE s.id = (SELECT ship_id FROM players WHERE id = $1) FOR UPDATE OF s`,
            [playerId],
        );
        if (shipRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Ship not found' });
            return;
        }

        const { ship_id, current_qty, max_qty } = shipRes.rows[0];

        if (max_qty <= 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: `Your ship cannot carry ${opts.itemName}`,
            });
            return;
        }

        if (current_qty + qty > max_qty) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: `Cannot hold that many ${opts.itemName} (max ${max_qty})`,
            });
            return;
        }

        const credRes = await client.query(
            'SELECT credits FROM players WHERE id = $1 FOR UPDATE',
            [playerId],
        );
        if (credRes.rows.length === 0 || credRes.rows[0].credits < cost) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Insufficient credits' });
            return;
        }

        await client.query('UPDATE players SET credits = credits - $1 WHERE id = $2', [
            cost,
            playerId,
        ]);
        await client.query(
            `UPDATE ships SET ${opts.shipColumn} = ${opts.shipColumn} + $1 WHERE id = $2`,
            [qty, ship_id],
        );
        await client.query('COMMIT');

        sendEnvelope(playerId, {
            type: opts.resultType,
            quantity: qty,
            totalOnShip: current_qty + qty,
            credits: credRes.rows[0].credits - cost,
            ...opts.resultExtra,
        } as any);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Buy hardware error', err);
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

/** Generic helper for buying boolean (toggle) hardware items. */
async function buyToggleHardware(
    playerId: number,
    opts: {
        shipColumn: string;
        canHaveColumn: string;
        unitPrice: number;
        itemName: string;
        resultType: string;
        resultExtra?: Record<string, any>;
    },
): Promise<void> {
    const player = players[playerId];
    if (!player?.at_starbase) {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Not at Starbase' });
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const shipRes = await client.query(
            `SELECT s.id as ship_id, s.${opts.shipColumn} as has_item, st.${opts.canHaveColumn} as can_have
             FROM ships s JOIN ship_types st ON s.ship_type_id = st.id
             WHERE s.id = (SELECT ship_id FROM players WHERE id = $1) FOR UPDATE OF s`,
            [playerId],
        );
        if (shipRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Ship not found' });
            return;
        }

        if (!shipRes.rows[0].can_have) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: `Ship cannot equip ${opts.itemName}`,
            });
            return;
        }

        if (shipRes.rows[0].has_item) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, {
                type: ServerMsgType.Error,
                message: `Ship already has ${opts.itemName}`,
            });
            return;
        }

        const credRes = await client.query(
            'SELECT credits FROM players WHERE id = $1 FOR UPDATE',
            [playerId],
        );
        if (credRes.rows.length === 0 || credRes.rows[0].credits < opts.unitPrice) {
            await client.query('ROLLBACK');
            sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Insufficient credits' });
            return;
        }

        await client.query(`UPDATE ships SET ${opts.shipColumn} = TRUE WHERE id = $1`, [
            shipRes.rows[0].ship_id,
        ]);
        await client.query('UPDATE players SET credits = credits - $1 WHERE id = $2', [
            opts.unitPrice,
            playerId,
        ]);
        await client.query('COMMIT');

        sendEnvelope(playerId, {
            type: opts.resultType,
            credits: credRes.rows[0].credits - opts.unitPrice,
            ...opts.resultExtra,
        } as any);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Buy hardware error', err);
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

// --- Stackable hardware ---

export async function handleBuyBuoys(playerId: number, quantity: number): Promise<void> {
    return buyStackableHardware(playerId, quantity, {
        shipColumn: 'buoys',
        maxColumn: 'max_buoy',
        unitPrice: 100,
        itemName: 'Space Buoys',
        resultType: ServerMsgType.BuyBuoysResult,
    });
}

export async function handleBuyProximityMines(playerId: number, quantity: number): Promise<void> {
    return buyStackableHardware(playerId, quantity, {
        shipColumn: 'proximity_mines',
        maxColumn: 'max_proximity',
        unitPrice: 1000,
        itemName: 'Proximity Mines',
        resultType: ServerMsgType.BuyMinesResult,
        resultExtra: { mineType: 'proximity' },
    });
}

export async function handleBuySeekerMines(playerId: number, quantity: number): Promise<void> {
    return buyStackableHardware(playerId, quantity, {
        shipColumn: 'seeker_mines',
        maxColumn: 'max_seeker',
        unitPrice: 2500,
        itemName: 'Seeker Mines',
        resultType: ServerMsgType.BuyMinesResult,
        resultExtra: { mineType: 'seeker' },
    });
}

export async function handleBuyOrbitalMines(playerId: number, quantity: number): Promise<void> {
    return buyStackableHardware(playerId, quantity, {
        shipColumn: 'orbital_mines',
        maxColumn: 'max_orbital',
        unitPrice: 5000,
        itemName: 'Orbital Mines',
        resultType: ServerMsgType.BuyMinesResult,
        resultExtra: { mineType: 'orbital' },
    });
}

export async function handleBuyMineDisruptors(playerId: number, quantity: number): Promise<void> {
    return buyStackableHardware(playerId, quantity, {
        shipColumn: 'mine_disruptors',
        maxColumn: 'max_disruptors',
        unitPrice: 2000,
        itemName: 'Mine Disruptors',
        resultType: ServerMsgType.BuyMineDisruptorsResult,
    });
}

export async function handleBuyCloakingDevice(playerId: number, quantity: number): Promise<void> {
    return buyStackableHardware(playerId, quantity, {
        shipColumn: 'cloaking_devices',
        maxColumn: 'max_cloaking',
        unitPrice: 25000,
        itemName: 'Cloaking Devices',
        resultType: ServerMsgType.BuyCloakingDeviceResult,
    });
}

export async function handleBuyCorbomite(playerId: number, quantity: number): Promise<void> {
    return buyStackableHardware(playerId, quantity, {
        shipColumn: 'corbomite',
        maxColumn: 'max_corbomite',
        unitPrice: 5000,
        itemName: 'Corbomite',
        resultType: ServerMsgType.BuyCorbomiteResult,
    });
}

export async function handleBuyPhotonTorpedoes(playerId: number, quantity: number): Promise<void> {
    return buyStackableHardware(playerId, quantity, {
        shipColumn: 'photon_torpedoes',
        maxColumn: 'max_photon',
        unitPrice: 10000,
        itemName: 'Photon Torpedoes',
        resultType: ServerMsgType.BuyPhotonTorpedoesResult,
    });
}

export async function handleBuyReconDrones(playerId: number, quantity: number): Promise<void> {
    return buyStackableHardware(playerId, quantity, {
        shipColumn: 'recon_drones',
        maxColumn: 'max_recon_drones',
        unitPrice: 500,
        itemName: 'Recon Drones',
        resultType: ServerMsgType.BuyReconDronesResult,
    });
}

// --- Toggle hardware ---

export async function handleBuyVisualScanner(playerId: number): Promise<void> {
    return buyToggleHardware(playerId, {
        shipColumn: 'has_visual_scanner',
        canHaveColumn: 'can_have_visual_scanner',
        unitPrice: 10000,
        itemName: 'Visual Scanner',
        resultType: ServerMsgType.BuyVisualScannerResult,
    });
}

export async function handleBuyPlanetScanner(playerId: number): Promise<void> {
    return buyToggleHardware(playerId, {
        shipColumn: 'has_planet_scanner',
        canHaveColumn: 'can_have_planet_scanner',
        unitPrice: 15000,
        itemName: 'Planet Scanner',
        resultType: ServerMsgType.BuyPlanetScannerResult,
    });
}

export async function handleBuyHyperspaceDrive(
    playerId: number,
    driveType: 1 | 2,
): Promise<void> {
    if (driveType === 1) {
        return buyToggleHardware(playerId, {
            shipColumn: 'has_hyperspace_1',
            canHaveColumn: 'can_have_hyperspace_1',
            unitPrice: 50000,
            itemName: 'Hyperspace Drive Type 1',
            resultType: ServerMsgType.BuyHyperspaceDriveResult,
            resultExtra: { driveType: 1 },
        });
    } else {
        return buyToggleHardware(playerId, {
            shipColumn: 'has_hyperspace_2',
            canHaveColumn: 'can_have_hyperspace_2',
            unitPrice: 100000,
            itemName: 'Hyperspace Drive Type 2',
            resultType: ServerMsgType.BuyHyperspaceDriveResult,
            resultExtra: { driveType: 2 },
        });
    }
}
