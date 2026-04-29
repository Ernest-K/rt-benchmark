'use strict';
const http = require('http');
const nodeDataChannel = require('node-datachannel');

const SIGNAL_PORT = 8082;

// ── State ─────────────────────────────────────────────────────────────────────
const serverPCs = new Map();   // clientId -> pc
const dataChannels = new Map(); // clientId -> dc

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

    if (req.method === 'POST' && req.url === '/signal') {
        let payload;
        try {
            payload = await parseBody(req);
        } catch {
            res.writeHead(400);
            res.end('Bad JSON');
            return;
        }

        const { clientId, sdp, type, candidates } = payload;

        try {
            const pc = new nodeDataChannel.PeerConnection(`server-${clientId}`, { iceServers: [] });
            serverPCs.set(clientId, pc);

            pc.onDataChannel((dc) => {
                dataChannels.set(clientId, dc);
                console.log(`✅ DataChannel open for client ${clientId} (total: ${dataChannels.size})`);

                dc.onMessage((msg) => {
                    // Broadcast to all OTHER data channels
                    const payload = typeof msg === 'string' ? msg : msg.toString();
                    for (const [id, otherDc] of dataChannels) {
                        if (id !== clientId) {
                            try { otherDc.sendMessage(payload); } catch (_) {}
                        }
                    }
                });

                dc.onClosed(() => {
                    dataChannels.delete(clientId);
                    serverPCs.delete(clientId);
                    console.log(`❌ DataChannel closed for client ${clientId}`);
                });
            });

            pc.setRemoteDescription(sdp, type);
            for (const c of (candidates || [])) {
                try { pc.addRemoteCandidate(c.candidate, c.mid); } catch (_) {}
            }

            const answerDesc = await new Promise((resolve, reject) => {
                const t = setTimeout(() => reject(new Error('SDP timeout')), 8000);
                pc.onLocalDescription((aSdp, aType) => { clearTimeout(t); resolve({ sdp: aSdp, type: aType }); });
            });

            const localCandidates = [];
            pc.onLocalCandidate((candidate, mid) => localCandidates.push({ candidate, mid }));
            await new Promise(r => setTimeout(r, 400));

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ sdp: answerDesc.sdp, type: answerDesc.type, candidates: localCandidates }));

        } catch (err) {
            console.error('Signal error:', err.message);
            res.writeHead(500);
            res.end(err.message);
        }
        return;
    }

    res.writeHead(404);
    res.end('Not found');
});

server.listen(SIGNAL_PORT, () => {
    console.log(`🚀 WebRTC Broadcast server (signaling)  →  http://localhost:${SIGNAL_PORT}`);
});

process.on('SIGINT', () => {
    for (const pc of serverPCs.values()) { try { pc.close(); } catch (_) {} }
    server.close();
    process.exit(0);
});
