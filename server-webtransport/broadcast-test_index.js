// WebTransport Broadcast Test Server
// When any session sends a message (via stream or datagram),
// the server forwards it to all OTHER active sessions.

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Http3Server } from '@fails-components/webtransport';
import { generateWebTransportCertificate } from './mkcert.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HTTP_PORT = 3000;
const WT_PORT   = 4433;
const HOST      = 'localhost';
const MKCERT_CERT = path.join(__dirname, 'localhost.pem');
const MKCERT_KEY  = path.join(__dirname, 'localhost-key.pem');

// ── Session Registry ──────────────────────────────────────────────────────────
// sessionId -> { dgWriter, streamWriters: Set<WritableStreamDefaultWriter> }
let sessionIdCounter = 0;
const sessions = new Map();

async function loadCertificate() {
    if (fs.existsSync(MKCERT_CERT) && fs.existsSync(MKCERT_KEY)) {
        return { cert: fs.readFileSync(MKCERT_CERT, 'utf8'), private: fs.readFileSync(MKCERT_KEY, 'utf8'), fingerprint: null };
    }
    console.log('⚠️  Generating self-signed certificate (10 days)');
    return generateWebTransportCertificate([{ shortName: 'CN', value: 'localhost' }], { days: 10 });
}

function broadcastDatagram(senderSessionId, data) {
    for (const [id, sess] of sessions) {
        if (id !== senderSessionId && sess.dgWriter) {
            sess.dgWriter.write(data).catch(() => {});
        }
    }
}

function broadcastStream(senderSessionId, data) {
    for (const [id, sess] of sessions) {
        if (id !== senderSessionId) {
            for (const writer of sess.streamWriters) {
                writer.write(data).catch(() => {});
            }
        }
    }
}

async function handleSession(session) {
    const sessionId = ++sessionIdCounter;
    const streamWriters = new Set();

    let dgWriter;
    try {
        dgWriter = session.datagrams.writable.getWriter();
    } catch (_) {}

    sessions.set(sessionId, { dgWriter, streamWriters });
    console.log(`🔗 Session ${sessionId} connected (total: ${sessions.size})`);

    session.ready.then(async () => {
        // ── Datagram broadcast ──
        const dgReader = session.datagrams.readable.getReader();
        (async () => {
            try {
                while (true) {
                    const { done, value } = await dgReader.read();
                    if (done) break;
                    broadcastDatagram(sessionId, value);
                }
            } catch (_) {}
        })();

        // ── Stream broadcast ──
        try {
            const bidiReader = session.incomingBidirectionalStreams.getReader();
            while (true) {
                const { done, value: stream } = await bidiReader.read();
                if (done) break;

                // Give this session a writer for replies (server → this client)
                const writer = stream.writable.getWriter();
                streamWriters.add(writer);

                const reader = stream.readable.getReader();
                (async () => {
                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            broadcastStream(sessionId, value);
                        }
                    } catch (_) {}
                })();
            }
        } catch (_) {}

    }).catch(e => console.error('Session not ready:', e));

    session.closed.then(() => {
        sessions.delete(sessionId);
        console.log(`❌ Session ${sessionId} closed (total: ${sessions.size})`);
    }).catch(() => {
        sessions.delete(sessionId);
    });
}

async function main() {
    const certificate = await loadCertificate();

    const httpsServer = https.createServer({ cert: certificate.cert, key: certificate.private }, (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.url === '/fingerprint') {
            const payload = certificate.fingerprint
                ? certificate.fingerprint.split(':').map(h => parseInt(h, 16))
                : null;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(payload));
            return;
        }
        res.writeHead(404);
        res.end();
    });

    httpsServer.listen(HTTP_PORT, () => {
        console.log(`\n🌐 HTTPS (fingerprint)  →  https://${HOST}:${HTTP_PORT}/fingerprint`);
        console.log(`⚡ WebTransport          →  https://${HOST}:${WT_PORT}`);
    });

    const h3Server = new Http3Server({
        host: HOST, port: WT_PORT,
        secret: 'rt-benchmark-secret',
        cert: certificate.cert, privKey: certificate.private,
    });
    h3Server.startServer();

    let isKilled = false;
    const shutdown = () => { isKilled = true; h3Server.stopServer(); httpsServer.close(); process.exit(0); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    const sessionStream = await h3Server.sessionStream('/');
    const sessionReader = sessionStream.getReader();

    console.log('\nWaiting for WebTransport connections...\n');
    while (!isKilled) {
        const { done, value: session } = await sessionReader.read();
        if (done) break;
        handleSession(session);
    }
}

main().catch(console.error);
