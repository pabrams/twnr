const numSectors = 100;

import { WebSocket, WebSocketServer } from 'ws';
import { connectDB, SectorWarps } from './db.js';
import express from 'express';
import { createServer, Server } from 'http';
import { getRandomInt } from './tools.js';

// Create Express app and HTTP server
const app = express();
const server: Server = createServer(app);
const wss = new WebSocketServer({ server });

// Connect to MongoDB and initialize graph
async function startServer() {
  try {
    await connectDB();
    await getGraph();

    // Start server
    server.listen(3000, () => {
      console.log('🚀 Server listening on port 3000');
    });
  } catch (error) {
    console.error('❌ Error during server startup:', error);
    process.exit(1);
  }
}

// ✅ Start the server
startServer();

// WebSocket connection logic
wss.on('connection', (ws: WebSocket) => {
  console.log('✅ New WebSocket client connected');

  const playerId = 1;
  const sector = 1;

  players[playerId] = { ws, sector };
  ws.send(JSON.stringify({ type: 'welcome', playerId, sector }));
  console.log(`${playerId} connected.`);

  ws.on('message', (message) => {
    const data = JSON.parse(message.toString());
    if (data.type === 'move') {
      if (players[playerId]) {
        players[playerId].sector = data.sector;
      }
      broadcast({ type: 'playerMoved', playerId, sector: data.sector });
    } else if (data.type === 'who') {
      const playersKeys = Object.keys(players).map(Number);
      ws.send(JSON.stringify({ type: 'playersOnline', players: playersKeys }));
    }
  });

  ws.on('close', () => {
    console.log(`${playerId} disconnected.`);
    delete players[playerId];
    broadcast({ type: 'playerLeft', playerId });
  });
});

interface Player {
  ws: WebSocket;
  sector: number;
}

const players: Record<number, Player> = {}; 

// Function to create a new graph and store it in the DB
async function createGraph(size: number) {
    if (size < 10) {
        console.error("Number of sectors must be ten or greater");
    }

    await SectorWarps.deleteMany({}); // Clear any existing graph

    for (let i = 0; i < size; i++) {
        console.log("sector " + i);
        // Ensure every node has at least one exit
        const warps: number[] = [];
        const rand = getRandomInt(1, 6);
        while (warps.length <= rand) {
            const exit = Math.floor(Math.random() * size) + 1;
            if (exit !==i && warps.indexOf(exit) === -1){
                warps.push(exit); 
            }
        }

        await SectorWarps.create({ nodeNumber: i, warps: warps });
    }
    console.log(`Graph with ${size} nodes created.`);
}

// Function to retrieve the existing graph from DB
async function getGraph() {
    const graph = await SectorWarps.find({});
    if (graph.length === 0) {
        console.log('No graph found in DB, creating a new one.');
        await createGraph(numSectors);
    }

    let adjacencyList: number[][] = [];

    graph.forEach((node) => {
        adjacencyList[node.nodeNumber] = node.warps;
    });

    console.log(adjacencyList);
    return adjacencyList;
}

function broadcast(data: object) {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(data));
    }
  });
}
