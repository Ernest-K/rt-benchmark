'use strict';
const http = require('http');
const nodeDataChannel = require('node-datachannel');
const fs = require('fs');
const path = require('path');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// ── Args ──────────────────────────────────────────────────────────────────────
const serverId   = process.argv[2];
const clientLoad = process.argv[3];
const outputDir  = process.argv[4] || path.join(__dirname, '..', 'results', 'echo-test');

if (!serverId || !clientLoad) {
    console.error('Usage: node echo-test_index.js <server-id> <num-clients> [output-dir]');
    console.error('Example: node echo-test_index.js webrtc 100');
    process.exit(1);
}

const SIGNAL_PORT = 8082;

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
let messageCounter = 0;
// Keep references to PeerConnections to prevent GC
const serverPCs = new Map(); // clientId -> pc

setInterval(() => {
    throughputCsvWriter.writeRecords([{ timestamp: getLocalTimestamp(), throughput: messageCounter }]);
    console.log(`Throughput: ${messageCounter} msg/s  |  Active PCs: ${serverPCs.size}`);
    messageCounter = 0;
}, 1000);

// ── Signaling helpers ─────────────────────────────────────────────────────────
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
        req.on('error', reject);
    });
}

// ── Signaling HTTP Server ─────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // POST /signal  →  receive client offer, return server answer
    if (req.method === 'POST' && req.url === '/signal') {
        let payload;
        try {
            payload = await parseBody(req);
        } catch (e) {
            res.writeHead(400);
            res.end('Bad JSON');
            return;
        }

        const { clientId, sdp, type, candidates } = payload;

        try {
            const pc = new nodeDataChannel.PeerConnection(`server-${clientId}`, {
                iceServers: [],
                // Use localhost only for ICE
            });

            serverPCs.set(clientId, pc);

            // When client data channel arrives, set up echo
            pc.onDataChannel((dc) => {
                console.log(`✅ DataChannel open for client ${clientId}`);
                dc.onMessage((msg) => {
                    messageCounter++;
                    dc.sendMessage(typeof msg === 'string' ? msg : msg.toString());
                });
                dc.onClosed(() => {
                    console.log(`❌ DataChannel closed for client ${clientId}`);
                    serverPCs.delete(clientId);
                });
                dc.onError((err) => console.error(`DC error (${clientId}):`, err));
            });

            // Set remote description (client's offer)
            pc.setRemoteDescription(sdp, type);

            // Add client's ICE candidates
            for (const c of (candidates || [])) {
                try { pc.addRemoteCandidate(c.candidate, c.mid); } catch (_) {}
            }

            // Collect server's local description (answer) and candidates
            const answerDesc = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('SDP timeout')), 8000);
                pc.onLocalDescription((aSdp, aType) => {
                    clearTimeout(timeout);
                    resolve({ sdp: aSdp, type: aType });
                });
            });

            // Wait briefly for ICE candidates (loopback gathers fast)
            const localCandidates = [];
            pc.onLocalCandidate((candidate, mid) => {
                localCandidates.push({ candidate, mid });
            });
            await new Promise(r => setTimeout(r, 400));

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                sdp: answerDesc.sdp,
                type: answerDesc.type,
                candidates: localCandidates,
            }));

        } catch (err) {
            console.error('Signal error:', err.message);
            res.writeHead(500);
            res.end(err.message);
        }
        return;
    }

    // DELETE /signal/:clientId  →  cleanup
    const deleteMatch = req.url.match(/^\/signal\/(.+)$/);
    if (req.method === 'DELETE' && deleteMatch) {
        const clientId = deleteMatch[1];
        const pc = serverPCs.get(clientId);
        if (pc) { try { pc.close(); } catch (_) {} serverPCs.delete(clientId); }
        res.writeHead(200);
        res.end('ok');
        return;
    }

    res.writeHead(404);
    res.end('Not found');
});

server.listen(SIGNAL_PORT, () => {
    console.log(`🚀 WebRTC Echo server (signaling)  →  http://localhost:${SIGNAL_PORT}`);
    console.log(`📝 Throughput log                  →  throughput_${serverId}_${clientLoad}clients.csv`);
});

process.on('SIGINT', () => {
    console.log('\nShutting down...');
    for (const pc of serverPCs.values()) { try { pc.close(); } catch (_) {} }
    server.close();
    process.exit(0);
});
