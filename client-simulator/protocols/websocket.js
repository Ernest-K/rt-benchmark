// protocols/websocket.js
// Standard WebSocket client using the built-in `ws` npm package.

import WebSocket from 'ws';

// ── Echo ──────────────────────────────────────────────────────────────────────

export async function connectEcho(id, config) {
    const connectionStart = process.hrtime.bigint();

    const ws = await new Promise((resolve, reject) => {
        const socket = new WebSocket(config.WEBSOCKET_URL);
        socket.once('open',  () => resolve(socket));
        socket.once('error', reject);
    });

    const connectionTimeMs = Number(process.hrtime.bigint() - connectionStart) / 1_000_000;

    let messageHandler = null;
    ws.on('message', (data) => {
        if (messageHandler) messageHandler(data.toString());
    });
    ws.on('error', () => {});

    return {
        connectionTimeMs,
        send(payload) { if (ws.readyState === WebSocket.OPEN) ws.send(payload); },
        onMessage(handler) { messageHandler = handler; },
        close() { ws.terminate(); },
    };
}

// ── Broadcast ─────────────────────────────────────────────────────────────────

export async function connectBroadcast(id, config) {
    const connectionStart = process.hrtime.bigint();

    const ws = await new Promise((resolve, reject) => {
        const socket = new WebSocket(config.WEBSOCKET_URL);
        socket.once('open',  () => resolve(socket));
        socket.once('error', reject);
    });

    const connectionTimeMs = Number(process.hrtime.bigint() - connectionStart) / 1_000_000;

    let broadcastHandler = null;
    ws.on('message', (data) => {
        if (broadcastHandler) broadcastHandler(data.toString());
    });
    ws.on('error', () => {});

    return {
        connectionTimeMs,
        send(payload) { if (ws.readyState === WebSocket.OPEN) ws.send(payload); },
        onBroadcast(handler) { broadcastHandler = handler; },
        close() { ws.terminate(); },
    };
}
