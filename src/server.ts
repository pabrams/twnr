import { WebSocket, WebSocketServer } from 'ws';
import { connectDB, pool } from './db.js';
import express from 'express';
import { createServer, Server } from 'http';
import fs from 'fs';
import path from 'path';

const shipConfigs: Record<string, any> = {};
try {
  const shipsDir = path.join(process.cwd(), 'config', 'ships');
  const files = fs.readdirSync(shipsDir);
  for (const file of files) {
    if (file.endsWith('.json')) {
      const data = JSON.parse(fs.readFileSync(path.join(shipsDir, file), 'utf-8'));
      shipConfigs[data.name] = data;
    }
  }
} catch (e) {
  console.error("Could not load ship configs", e);
}

const app = express();
app.use(express.json());
const server: Server = createServer(app);
const wss = new WebSocketServer({ server });

interface Player {
  ws: WebSocket;
  sector: number;
}
const players: Record<number, Player> = {};

// Port class trading rules: 'S' = port Sells to player (player buys), 'B' = port Buys from player (player sells)
const PORT_CLASS_ACTIONS: Record<number, Record<string, 'B' | 'S'>> = {
  1: { fuel: 'B', organics: 'B', equipment: 'S' },
  2: { fuel: 'B', organics: 'S', equipment: 'B' },
  3: { fuel: 'S', organics: 'B', equipment: 'B' },
  4: { fuel: 'S', organics: 'S', equipment: 'B' },
  5: { fuel: 'B', organics: 'S', equipment: 'S' },
  6: { fuel: 'S', organics: 'B', equipment: 'S' },
  7: { fuel: 'S', organics: 'S', equipment: 'S' },
  8: { fuel: 'B', organics: 'B', equipment: 'B' },
};

export async function getGraph(): Promise<number[][]> {
    const sectorsRes = await pool.query('SELECT id FROM sectors ORDER BY id ASC');
    const size = sectorsRes.rows.length;

    if (size === 0) {
        throw new Error('No sectors found in database. Load universe data before starting the server.');
    }

    let adjacencyList: number[][] = [];
    // Initialize array with empty arrays
    for (let i = 0; i <= size; i++) {
        adjacencyList[i] = [];
    }

    const warpsRes = await pool.query('SELECT sector_from, sector_to FROM warps');
    for (const row of warpsRes.rows) {
        if (adjacencyList[row.sector_from]) {
            adjacencyList[row.sector_from].push(row.sector_to);
        }
    }

    return adjacencyList;
}

// Scoped broadcasts
function broadcastTo(data: object, targetClients: Set<WebSocket> | WebSocket[]) {
    for (const client of targetClients) {
        if (client.readyState === 1) {
            client.send(JSON.stringify(data));
        }
    }
}

wss.on('connection', async (ws: WebSocket) => {
  console.log('New WebSocket client connected');
  try {
      const res = await pool.query('INSERT INTO players (name, current_sector) VALUES ($1, $2) RETURNING id', ['Player', 1]);
      const playerId = res.rows[0].id;
      const sector = 1;

      await pool.query(`
          INSERT INTO ship_cargo (player_id, fuel, organics, equipment, credits) 
          VALUES ($1, 0, 0, 0, 10000) 
          ON CONFLICT (player_id) DO NOTHING
      `, [playerId]);

      const merchant = shipConfigs['Merchant Freighter'];
      if (merchant) {
          await pool.query(`
              INSERT INTO player_ships (player_id, ship_name, fighters, shields, cargo_limit)
              VALUES ($1, $2, $3, $4, $5)
              ON CONFLICT (player_id) DO NOTHING
          `, [playerId, merchant.name, 0, 0, merchant.startingHolds]);
      }

      players[playerId] = { ws, sector };
      ws.send(JSON.stringify({ type: 'welcome', playerId, sector }));
      console.log(`${playerId} connected.`);

      ws.on('message', async (message) => {
        const warps = await getGraph();
        const data = JSON.parse(message.toString());
        
        if (data.type === 'move') {
            const shipRes = await pool.query('SELECT player_id FROM player_ships WHERE player_id = $1', [playerId]);
            if (shipRes.rows.length === 0) {
                ws.send(JSON.stringify({ type: 'noShip' }));
                return;
            }

            if (players[playerId]) {
                const currentSector = players[playerId].sector;
                const targetSector = data.sector;
                
                if (warps[currentSector] && warps[currentSector].includes(targetSector)) {
                    players[playerId].sector = targetSector;
                    await pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [targetSector, playerId]);
                    
                    const clientsToNotify = new Set<WebSocket>();
                    for (const [idStr, p] of Object.entries(players)) {
                        if (p.sector === currentSector || p.sector === targetSector) {
                            clientsToNotify.add(p.ws);
                        }
                    }
                    broadcastTo({ type: 'playerMoved', playerId, sector: targetSector }, clientsToNotify);
                } else {
                    ws.send(JSON.stringify({ type: 'nonAdjacentMoveRequested', playerId, sector: targetSector }));
                }
            }
        } else if (data.type === 'who') {
            const playersKeys = Object.keys(players).map(Number);
            ws.send(JSON.stringify({ type: 'playersOnline', players: playersKeys }));
        } else if (data.type === 'display') {
            const currentSector = players[playerId].sector;
            const displayWarps = warps[currentSector] || [];
            ws.send(JSON.stringify({ type: "sectorDisplay", sector: currentSector, warps: displayWarps }));
        }
      });

      ws.on('close', () => {
        console.log(`${playerId} disconnected.`);
        const lastSector = players[playerId]?.sector;
        delete players[playerId];
        
        if (lastSector) {
            const clientsToNotify = new Set<WebSocket>();
            for (const p of Object.values(players)) {
                if (p.sector === lastSector) {
                    clientsToNotify.add(p.ws);
                }
            }
            broadcastTo({ type: 'playerLeft', playerId }, clientsToNotify);
        }
      });
  } catch (error) {
      console.error('Connection error:', error);
      ws.close();
  }
});

// REST Endpoints
app.get('/api/sector/:id', async (req, res): Promise<any> => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid sector ID" });
    }
    
    try {
        const sectorRes = await pool.query('SELECT id FROM sectors WHERE id = $1', [id]);
        if (sectorRes.rows.length === 0) {
            return res.status(404).json({ error: "Sector not found" });
        }
        
        const warpsRes = await pool.query('SELECT sector_to FROM warps WHERE sector_from = $1', [id]);
        const warps = warpsRes.rows.map(r => r.sector_to);
        
        res.json({ id, warps });
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get('/api/players/online', (req, res) => {
    const online = Object.entries(players).map(([idStr, p]) => ({
        playerId: parseInt(idStr, 10),
        sector: p.sector
    }));
    res.json({ players: online });
});

app.post('/api/move', async (req, res): Promise<any> => {
    const { playerId, targetSector } = req.body;
    
    if (playerId === undefined || targetSector === undefined) {
        return res.status(400).json({ error: "Invalid request" });
    }
    
    const pId = parseInt(playerId, 10);
    const ts = parseInt(targetSector, 10);
    
    const player = players[pId];
    if (!player) {
        return res.status(404).json({ error: "Player not found" });
    }
    
    const currentSector = player.sector;
    const warps = await getGraph();
    
    const shipRes = await pool.query('SELECT player_id FROM player_ships WHERE player_id = $1', [pId]);
    if (shipRes.rows.length === 0) {
        return res.status(400).json({ error: "No ship" });
    }

    if (!warps[currentSector] || !warps[currentSector].includes(ts)) {
        return res.status(400).json({ error: "Not adjacent" });
    }
    
    player.sector = ts;
    try {
        await pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [ts, pId]);
    } catch (e) {
        console.error("DB update error", e);
    }
    
    const clientsToNotify = new Set<WebSocket>();
    for (const p of Object.values(players)) {
        if (p.sector === currentSector || p.sector === ts) {
            clientsToNotify.add(p.ws);
        }
    }
    broadcastTo({ type: 'playerMoved', playerId: pId, sector: ts }, clientsToNotify);
    
    res.json({ success: true, sector: ts, warps: warps[ts] || [] });
});

app.get('/api/route/:from/:to', async (req, res): Promise<any> => {
    const from = parseInt(req.params.from, 10);
    const to = parseInt(req.params.to, 10);
    
    if (isNaN(from) || from <= 0 || isNaN(to) || to <= 0) {
        return res.status(400).json({ error: "Invalid sector ID" });
    }
    
    try {
        const sectorRes = await pool.query('SELECT id FROM sectors WHERE id IN ($1, $2)', [from, to]);
        if (sectorRes.rows.length !== (from === to ? 1 : 2)) {
            const foundIds = new Set(sectorRes.rows.map(r => r.id));
            if (!foundIds.has(from) || !foundIds.has(to)) {
                return res.status(404).json({ error: "Sector not found" });
            }
        }
        
        if (from === to) {
            return res.json({ path: [from], hops: 0 });
        }
        
        const warps = await getGraph();
        
        // BFS
        const queue: { sector: number, path: number[] }[] = [{ sector: from, path: [from] }];
        const visited = new Set<number>();
        visited.add(from);
        
        while (queue.length > 0) {
            const { sector, path } = queue.shift()!;
            
            const neighbors = warps[sector] || [];
            for (const neighbor of neighbors) {
                if (neighbor === to) {
                    const finalPath = [...path, neighbor];
                    return res.json({ path: finalPath, hops: finalPath.length - 1 });
                }
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push({ sector: neighbor, path: [...path, neighbor] });
                }
            }
        }
        
        res.status(404).json({ error: "No route found" });
        
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get('/api/port/:sectorId', async (req, res): Promise<any> => {
    const sectorId = parseInt(req.params.sectorId, 10);
    if (isNaN(sectorId) || sectorId <= 0) {
        return res.status(400).json({ error: "Invalid sector ID" });
    }
    
    try {
        const portRes = await pool.query(
            'SELECT sector_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price FROM ports WHERE sector_id = $1',
            [sectorId],
        );
        if (portRes.rows.length === 0) {
            return res.status(404).json({ error: "No port in this sector" });
        }

        const p = portRes.rows[0];
        res.json({
            sectorId: p.sector_id,
            class: p.class,
            fuel: p.fuel, fuelPrice: p.fuel_price,
            organics: p.organics, orgPrice: p.org_price,
            equipment: p.equipment, equPrice: p.equ_price,
        });
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get('/api/ship/:playerId', async (req, res): Promise<any> => {
    const playerId = parseInt(req.params.playerId, 10);
    if (isNaN(playerId) || playerId <= 0) {
        return res.status(400).json({ error: "Invalid player ID" });
    }
    
    try {
        const query = `
            SELECT ps.ship_name, ps.fighters, ps.shields, ps.cargo_limit,
                   sc.fuel, sc.organics, sc.equipment
            FROM player_ships ps
            JOIN ship_cargo sc ON ps.player_id = sc.player_id
            WHERE ps.player_id = $1
        `;
        const result = await pool.query(query, [playerId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Player not found" });
        }
        
        const row = result.rows[0];
        const config = shipConfigs[row.ship_name];
        if (!config) {
            return res.status(500).json({ error: "Ship config missing" });
        }

        const holdsAvailable = row.cargo_limit - (row.fuel + row.organics + row.equipment);
        
        res.json({
            playerId,
            shipName: row.ship_name,
            fighters: row.fighters,
            shields: row.shields,
            maxFighters: config.maxFighters,
            maxShields: config.maxShields,
            cargoLimit: row.cargo_limit,
            maxHolds: config.maxHolds,
            cargoFuel: row.fuel,
            cargoOrganics: row.organics,
            cargoEquipment: row.equipment,
            holdsAvailable
        });
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get('/api/cargo/:playerId', async (req, res): Promise<any> => {
    const playerId = parseInt(req.params.playerId, 10);
    if (isNaN(playerId) || playerId <= 0) {
        return res.status(400).json({ error: "Invalid player ID" });
    }
    
    try {
        const cargoRes = await pool.query('SELECT player_id, fuel, organics, equipment, credits FROM ship_cargo WHERE player_id = $1', [playerId]);
        if (cargoRes.rows.length === 0) {
            return res.status(404).json({ error: "Player not found" });
        }
        
        const c = cargoRes.rows[0];
        res.json({ playerId: c.player_id, fuel: c.fuel, organics: c.organics, equipment: c.equipment, credits: c.credits });
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post('/api/trade', async (req, res): Promise<any> => {
    const { playerId, good, quantity, action } = req.body;
    
    if (playerId === undefined || good === undefined || quantity === undefined || action === undefined) {
        return res.status(400).json({ error: "Invalid request" });
    }
    
    if (!["fuel", "organics", "equipment"].includes(good)) {
        return res.status(400).json({ error: "Invalid request" });
    }
    
    if (!["buy", "sell"].includes(action)) {
        return res.status(400).json({ error: "Invalid request" });
    }
    
    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({ error: "Invalid request" });
    }
    
    const pId = parseInt(playerId, 10);
    const player = players[pId];
    if (!player) {
        return res.status(404).json({ error: "Player not found" });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const pRes = await client.query('SELECT current_sector FROM players WHERE id = $1', [pId]);
        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Player not found" });
        }
        const currentSector = pRes.rows[0].current_sector;

        const portRes = await client.query(
            'SELECT class, fuel, fuel_price, organics, org_price, equipment, equ_price FROM ports WHERE sector_id = $1 FOR UPDATE',
            [currentSector],
        );
        if (portRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "No port in this sector" });
        }

        const port = portRes.rows[0];

        // Validate that this port's class supports the requested action on this commodity
        const priceColMap: Record<string, string> = { fuel: 'fuel_price', organics: 'org_price', equipment: 'equ_price' };
        const portActions = PORT_CLASS_ACTIONS[port.class];
        if (!portActions || (action === 'buy' && portActions[good] !== 'S') || (action === 'sell' && portActions[good] !== 'B')) {
            await client.query('ROLLBACK');
            console.error("TRADE FAIL REASON:", portActions, action, good); return res.status(400).json({ error: "Port does not trade this commodity" });
        }

        const price: number = port[priceColMap[good]];

        const cargoRes = await client.query(`
            SELECT sc.fuel, sc.organics, sc.equipment, sc.credits, ps.cargo_limit 
            FROM ship_cargo sc
            JOIN player_ships ps ON sc.player_id = ps.player_id
            WHERE sc.player_id = $1 FOR UPDATE
        `, [pId]);
        if (cargoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Player not found" });
        }

        const cargo = cargoRes.rows[0];

        if (action === "buy") {
            const cost = qty * price;
            if (cargo.credits < cost) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: "Insufficient credits" });
            }
            if (port[good] < qty) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: "Insufficient port inventory" });
            }
            if (cargo.fuel + cargo.organics + cargo.equipment + qty > cargo.cargo_limit) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: "Insufficient cargo holds" });
            }

            await client.query(`UPDATE ports SET ${good} = ${good} - $1 WHERE sector_id = $2`, [qty, currentSector]);
            await client.query(`UPDATE ship_cargo SET ${good} = ${good} + $1, credits = credits - $2 WHERE player_id = $3`, [qty, cost, pId]);

            await client.query('COMMIT');

            cargo[good] += qty;
            cargo.credits -= cost;
            res.json({ success: true, credits: cargo.credits, cargo: { fuel: cargo.fuel, organics: cargo.organics, equipment: cargo.equipment } });

        } else if (action === "sell") {
            const revenue = qty * price;
            if (cargo[good] < qty) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: "Insufficient cargo" });
            }

            await client.query(`UPDATE ports SET ${good} = ${good} + $1 WHERE sector_id = $2`, [qty, currentSector]);
            await client.query(`UPDATE ship_cargo SET ${good} = ${good} - $1, credits = credits + $2 WHERE player_id = $3`, [qty, revenue, pId]);

            await client.query('COMMIT');

            cargo[good] -= qty;
            cargo.credits += revenue;
            res.json({ success: true, credits: cargo.credits, cargo: { fuel: cargo.fuel, organics: cargo.organics, equipment: cargo.equipment } });
        }
        
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Trade error", err);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        client.release();
    }
});

app.post('/api/port/buy-fighters', async (req, res): Promise<any> => {
    const { playerId, quantity } = req.body;
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ error: "Invalid quantity" });
    const pId = parseInt(playerId, 10);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const pRes = await client.query('SELECT current_sector FROM players WHERE id = $1', [pId]);
        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Player not found" });
        }
        const currentSector = pRes.rows[0].current_sector;

        const portRes = await client.query('SELECT class FROM ports WHERE sector_id = $1', [currentSector]);
        if (portRes.rows.length === 0 || portRes.rows[0].class !== 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Not at a class 0 port" });
        }

        const cargoRes = await client.query(`
            SELECT sc.credits, ps.ship_name, ps.fighters, ps.shields, ps.cargo_limit 
            FROM ship_cargo sc
            JOIN player_ships ps ON sc.player_id = ps.player_id
            WHERE sc.player_id = $1 FOR UPDATE
        `, [pId]);
        
        if (cargoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Player not found" });
        }

        const data = cargoRes.rows[0];
        const config = shipConfigs[data.ship_name];
        if (data.fighters + qty > config.maxFighters) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Exceeds maximum" });
        }

        const cost = qty * 20;
        if (data.credits < cost) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Insufficient credits" });
        }

        await client.query('UPDATE player_ships SET fighters = fighters + $1 WHERE player_id = $2', [qty, pId]);
        await client.query('UPDATE ship_cargo SET credits = credits - $1 WHERE player_id = $2', [cost, pId]);
        await client.query('COMMIT');

        res.json({ success: true, credits: data.credits - cost, fighters: data.fighters + qty, shields: data.shields, cargoLimit: data.cargo_limit });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: "Internal server error" });
    } finally {
        client.release();
    }
});

app.post('/api/port/buy-shields', async (req, res): Promise<any> => {
    const { playerId, quantity } = req.body;
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ error: "Invalid quantity" });
    const pId = parseInt(playerId, 10);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const pRes = await client.query('SELECT current_sector FROM players WHERE id = $1', [pId]);
        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Player not found" });
        }
        const currentSector = pRes.rows[0].current_sector;

        const portRes = await client.query('SELECT class FROM ports WHERE sector_id = $1', [currentSector]);
        if (portRes.rows.length === 0 || portRes.rows[0].class !== 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Not at a class 0 port" });
        }

        const cargoRes = await client.query(`
            SELECT sc.credits, ps.ship_name, ps.fighters, ps.shields, ps.cargo_limit 
            FROM ship_cargo sc
            JOIN player_ships ps ON sc.player_id = ps.player_id
            WHERE sc.player_id = $1 FOR UPDATE
        `, [pId]);
        
        if (cargoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Player not found" });
        }

        const data = cargoRes.rows[0];
        const config = shipConfigs[data.ship_name];
        if (data.shields + qty > config.maxShields) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Exceeds maximum" });
        }

        const cost = qty * 10;
        if (data.credits < cost) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Insufficient credits" });
        }

        await client.query('UPDATE player_ships SET shields = shields + $1 WHERE player_id = $2', [qty, pId]);
        await client.query('UPDATE ship_cargo SET credits = credits - $1 WHERE player_id = $2', [cost, pId]);
        await client.query('COMMIT');

        res.json({ success: true, credits: data.credits - cost, fighters: data.fighters, shields: data.shields + qty, cargoLimit: data.cargo_limit });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: "Internal server error" });
    } finally {
        client.release();
    }
});

app.post('/api/port/buy-holds', async (req, res): Promise<any> => {
    const { playerId, quantity } = req.body;
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ error: "Invalid quantity" });
    const pId = parseInt(playerId, 10);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const pRes = await client.query('SELECT current_sector FROM players WHERE id = $1', [pId]);
        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Player not found" });
        }
        const currentSector = pRes.rows[0].current_sector;

        const portRes = await client.query('SELECT class FROM ports WHERE sector_id = $1', [currentSector]);
        if (portRes.rows.length === 0 || portRes.rows[0].class !== 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Not at a class 0 port" });
        }

        const cargoRes = await client.query(`
            SELECT sc.credits, ps.ship_name, ps.fighters, ps.shields, ps.cargo_limit 
            FROM ship_cargo sc
            JOIN player_ships ps ON sc.player_id = ps.player_id
            WHERE sc.player_id = $1 FOR UPDATE
        `, [pId]);
        
        if (cargoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Player not found" });
        }

        const data = cargoRes.rows[0];
        const config = shipConfigs[data.ship_name];
        if (data.cargo_limit + qty > config.maxHolds) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Exceeds maximum" });
        }

        const cost = qty * 50;
        if (data.credits < cost) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Insufficient credits" });
        }

        await client.query('UPDATE player_ships SET cargo_limit = cargo_limit + $1 WHERE player_id = $2', [qty, pId]);
        await client.query('UPDATE ship_cargo SET credits = credits - $1 WHERE player_id = $2', [cost, pId]);
        await client.query('COMMIT');

        res.json({ success: true, credits: data.credits - cost, fighters: data.fighters, shields: data.shields, cargoLimit: data.cargo_limit + qty });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: "Internal server error" });
    } finally {
        client.release();
    }
});

app.post('/api/ship/exchange', async (req, res): Promise<any> => {
    const { playerId, targetShipName } = req.body;
    const pId = parseInt(playerId, 10);

    const targetConfig = shipConfigs[targetShipName];
    if (!targetConfig) {
        return res.status(400).json({ error: "Unknown ship" });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const pRes = await client.query(`
            SELECT p.current_sector, s.name as sector_name 
            FROM players p 
            JOIN sectors s ON p.current_sector = s.id 
            WHERE p.id = $1
        `, [pId]);
        
        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Player not found" });
        }
        if (pRes.rows[0].sector_name !== 'Stardock') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Not at Stardock" });
        }

        const cargoRes = await client.query(`
            SELECT sc.credits, sc.fuel, sc.organics, sc.equipment, ps.ship_name 
            FROM ship_cargo sc
            JOIN player_ships ps ON sc.player_id = ps.player_id
            WHERE sc.player_id = $1 FOR UPDATE
        `, [pId]);
        
        if (cargoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Player not found" });
        }

        const data = cargoRes.rows[0];
        if (data.ship_name === targetShipName) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Already on that ship" });
        }

        const currentConfig = shipConfigs[data.ship_name];
        const cost = targetConfig.price - currentConfig.price;
        if (cost > 0 && data.credits < cost) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Insufficient credits" });
        }

        const newCargoLimit = targetConfig.startingHolds;
        const currentCargo = data.fuel + data.organics + data.equipment;
        if (newCargoLimit < currentCargo) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "New ship has insufficient holds for current cargo" });
        }

        await client.query(`
            UPDATE player_ships 
            SET ship_name = $1, fighters = 0, shields = 0, cargo_limit = $2 
            WHERE player_id = $3
        `, [targetShipName, newCargoLimit, pId]);
        
        await client.query('UPDATE ship_cargo SET credits = credits - $1 WHERE player_id = $2', [cost, pId]);
        await client.query('COMMIT');

        res.json({ 
            success: true, 
            shipName: targetShipName, 
            credits: data.credits - cost, 
            maxFighters: targetConfig.maxFighters, 
            maxShields: targetConfig.maxShields, 
            cargoLimit: newCargoLimit 
        });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: "Internal server error" });
    } finally {
        client.release();
    }
});

async function startServer() {
  try {
    await connectDB();
    await getGraph();

    server.listen(3000, () => {
      console.log('Server listening on port 3000');
    });
  } catch (error) {
    console.error('Error during server startup:', error);
    process.exit(1);
  }
}

// Only start the server if this file is run directly
if ( (process.argv[1] && process.argv[1].endsWith('server.js'))) {
    startServer();
}

export { app, server, wss, startServer };