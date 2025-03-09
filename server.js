import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8080 });
let players = {};

wss.on('connection', (ws) => {
    const playerId = `Player-${Math.floor(Math.random() * 1000)}`;
    const sector = 1;
    players[playerId] = { ws, sector };

    ws.send(JSON.stringify({ type: 'welcome', playerId, sector }));
    console.log(`${playerId} connected.`);

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        if (data.type === 'move') {
            players[playerId].sector = data.sector;
            broadcast({ type: 'playerMoved', playerId, sector: data.sector });
        } else if (data.type === 'who') {
            const sectorPlayers = Object.keys(players).filter(p => players[p].sector === data.sector);
            ws.send(JSON.stringify({ type: 'playersInSector', players: sectorPlayers }));
        }
    });

    ws.on('close', () => {
        console.log(`${playerId} disconnected.`);
        delete players[playerId];
        broadcast({ type: 'playerLeft', playerId });
    });
});

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            client.send(JSON.stringify(data));
        }
    });
}