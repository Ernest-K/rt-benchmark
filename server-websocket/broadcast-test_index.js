'use strict';
const WebSocket = require('ws');

const PORT = 8081;
const wss = new WebSocket.Server({ port: PORT });

wss.on('connection', (ws) => {
    console.log(`✅ Client connected (total: ${wss.clients.size})`);

    ws.on('message', (message) => {
        // Broadcast to all other connected clients
        const payload = message.toString();
        wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        });
    });

    ws.on('close', () => {
        console.log(`❌ Client disconnected (total: ${wss.clients.size})`);
    });

    ws.on('error', (err) => {
        console.error('WS error:', err.message);
    });
});

console.log(`🚀 WebSocket Broadcast server  →  ws://localhost:${PORT}`);

process.on('SIGINT',  () => { wss.close(); process.exit(0); });
process.on('SIGTERM', () => { wss.close(); process.exit(0); });
