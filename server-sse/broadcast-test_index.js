'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;

// ── State ─────────────────────────────────────────────────────────────────────
// All connected SSE receiver streams
const sseStreams = new Map(); // clientId -> res

// ── HTTP Server ───────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // GET /events/:clientId  →  SSE stream for receivers
    const eventsMatch = req.url.match(/^\/events\/(.+)$/);
    if (req.method === 'GET' && eventsMatch) {
        const clientId = eventsMatch[1];
        res.writeHead(200, {
            'Content-Type':  'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection':    'keep-alive',
        });
        res.write(': connected\n\n');
        sseStreams.set(clientId, res);
        console.log(`✅ SSE receiver connected: ${clientId} (total: ${sseStreams.size})`);

        req.on('close', () => {
            sseStreams.delete(clientId);
        });
        return;
    }

    // POST /broadcast  →  body = JSON with sendTime, broadcast to all SSE clients
    if (req.method === 'POST' && req.url === '/broadcast') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            const payload = `data: ${body}\n\n`;
            let sent = 0;
            for (const [, stream] of sseStreams) {
                if (!stream.destroyed) {
                    stream.write(payload);
                    sent++;
                }
            }
            console.log(`📡 Broadcast to ${sent} SSE clients`);
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('ok');
        });
        return;
    }

    res.writeHead(404);
    res.end('Not found');
});

server.listen(PORT, () => {
    console.log(`🚀 SSE Broadcast server  →  http://localhost:${PORT}`);
});

process.on('SIGINT',  () => { server.close(); process.exit(0); });
process.on('SIGTERM', () => { server.close(); process.exit(0); });
