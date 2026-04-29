'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// ── Args ──────────────────────────────────────────────────────────────────────
const serverId  = process.argv[2];
const clientLoad = process.argv[3];
const outputDir  = process.argv[4] || path.join(__dirname, '..', 'results', 'echo-test');

if (!serverId || !clientLoad) {
    console.error('Usage: node echo-test_index.js <server-id> <num-clients> [output-dir]');
    console.error('Example: node echo-test_index.js sse 100');
    process.exit(1);
}

const PORT = 8080;

// ── Output ────────────────────────────────────────────────────────────────────
fs.mkdirSync(outputDir, { recursive: true });

const throughputCsvWriter = createCsvWriter({
    path: path.join(outputDir, `throughput_${serverId}_${clientLoad}clients.csv`),
    header: [
        { id: 'timestamp', title: 'TIMESTAMP' },
        { id: 'throughput', title: 'THROUGHPUT_MSGS_PER_SEC' },
    ],
});

function getLocalTimestamp() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, -1);
}

// ── State ─────────────────────────────────────────────────────────────────────
// clientId (string) -> http.ServerResponse (the SSE stream)
const sseStreams = new Map();
let messageCounter = 0;

setInterval(() => {
    throughputCsvWriter.writeRecords([{ timestamp: getLocalTimestamp(), throughput: messageCounter }]);
    console.log(`Throughput: ${messageCounter} msg/s`);
    messageCounter = 0;
}, 1000);

// ── HTTP Server ───────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // GET /events/:clientId  →  open SSE stream for this client
    const eventsMatch = req.url.match(/^\/events\/(.+)$/);
    if (req.method === 'GET' && eventsMatch) {
        const clientId = eventsMatch[1];
        res.writeHead(200, {
            'Content-Type':  'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection':    'keep-alive',
        });
        // Keep-alive comment
        res.write(': connected\n\n');
        sseStreams.set(clientId, res);
        console.log(`✅ SSE client connected: ${clientId} (total: ${sseStreams.size})`);

        req.on('close', () => {
            sseStreams.delete(clientId);
            console.log(`❌ SSE client disconnected: ${clientId}`);
        });
        return;
    }

    // POST /echo/:clientId  →  body = JSON with sendTime, echo via SSE
    const echoMatch = req.url.match(/^\/echo\/(.+)$/);
    if (req.method === 'POST' && echoMatch) {
        const clientId = echoMatch[1];
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            messageCounter++;
            const stream = sseStreams.get(clientId);
            if (stream && !stream.destroyed) {
                // SSE event format
                stream.write(`data: ${body}\n\n`);
            }
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('ok');
        });
        return;
    }

    res.writeHead(404);
    res.end('Not found');
});

server.listen(PORT, () => {
    console.log(`🚀 SSE Echo server  →  http://localhost:${PORT}`);
    console.log(`📝 Throughput log   →  throughput_${serverId}_${clientLoad}clients.csv`);
});

process.on('SIGINT',  () => { server.close(); process.exit(0); });
process.on('SIGTERM', () => { server.close(); process.exit(0); });
