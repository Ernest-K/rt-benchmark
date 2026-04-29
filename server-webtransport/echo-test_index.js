// WebTransport Echo Test Server
// Supports both bidirectional stream echo and datagram echo.
// The server echoes every message back to the same client via the same channel.

import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Http3Server } from "@fails-components/webtransport";
import { generateWebTransportCertificate } from "./mkcert.js";
import { createObjectCsvWriter } from "csv-writer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Args ──────────────────────────────────────────────────────────────────────
const serverId = process.argv[2];
const clientLoad = process.argv[3];
const outputDir = process.argv[4] || path.join(__dirname, "..", "results", "echo-test");

if (!serverId || !clientLoad) {
    console.error("Usage: node echo-test_index.js <server-id> <num-clients> [output-dir]");
    console.error("Example: node echo-test_index.js webtransport-streams 100");
    process.exit(1);
}

const HTTP_PORT = 3000; // HTTPS: fingerprint endpoint
const WT_PORT = 4433; // HTTP/3 WebTransport
//const HOST = "localhost"; // for local testing
const HOST = "0.0.0.0";
const MKCERT_CERT = path.join(__dirname, "localhost.pem");
const MKCERT_KEY = path.join(__dirname, "localhost-key.pem");

// ── Output ────────────────────────────────────────────────────────────────────
fs.mkdirSync(outputDir, { recursive: true });

const throughputCsvWriter = createObjectCsvWriter({
    path: path.join(outputDir, `throughput_${serverId}_${clientLoad}clients.csv`),
    header: [
        { id: "timestamp", title: "TIMESTAMP" },
        { id: "throughput", title: "THROUGHPUT_MSGS_PER_SEC" },
    ],
});

function getLocalTimestamp() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, -1);
}

// ── State ─────────────────────────────────────────────────────────────────────
let messageCounter = 0;

setInterval(() => {
    throughputCsvWriter.writeRecords([{ timestamp: getLocalTimestamp(), throughput: messageCounter }]);
    console.log(`Throughput: ${messageCounter} msg/s`);
    messageCounter = 0;
}, 1000);

// ── Certificate ───────────────────────────────────────────────────────────────
async function loadCertificate() {
    if (fs.existsSync(MKCERT_CERT) && fs.existsSync(MKCERT_KEY)) {
        console.log("✅ Using mkcert certificate");
        return { cert: fs.readFileSync(MKCERT_CERT, "utf8"), private: fs.readFileSync(MKCERT_KEY, "utf8"), fingerprint: null };
    }
    console.log("⚠️  Generating self-signed certificate (10 days)");
    return generateWebTransportCertificate([{ shortName: "CN", value: "localhost" }], { days: 10 });
}

// ── Session Handler ───────────────────────────────────────────────────────────
async function handleSession(session) {
    console.log("🔗 New WebTransport session");

    session.ready
        .then(async () => {
            // ── Datagram echo ──
            const dgReader = session.datagrams.readable.getReader();
            const dgWriter = session.datagrams.writable.getWriter();

            (async () => {
                try {
                    while (true) {
                        const { done, value } = await dgReader.read();
                        if (done) break;
                        messageCounter++;
                        // Echo back
                        dgWriter.write(value).catch(() => {});
                    }
                } catch (_) {}
            })();

            // ── Bidirectional stream echo ──
            try {
                const bidiReader = session.incomingBidirectionalStreams.getReader();
                while (true) {
                    const { done, value: stream } = await bidiReader.read();
                    if (done) break;

                    const reader = stream.readable.getReader();
                    const writer = stream.writable.getWriter();

                    (async () => {
                        try {
                            while (true) {
                                const { done, value } = await reader.read();
                                if (done) break;
                                messageCounter++;
                                writer.write(value).catch(() => {});
                            }
                        } catch (_) {}
                    })();
                }
            } catch (_) {}
        })
        .catch((e) => console.error("Session not ready:", e));

    session.closed.catch(() => {});
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    const certificate = await loadCertificate();

    // HTTPS server — serves fingerprint for self-signed cert clients
    const httpsServer = https.createServer({ cert: certificate.cert, key: certificate.private }, (req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        if (req.url === "/fingerprint") {
            const payload = certificate.fingerprint ? certificate.fingerprint.split(":").map((h) => parseInt(h, 16)) : null;
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(payload));
            return;
        }
        res.writeHead(404);
        res.end("Not found");
    });

    httpsServer.listen(HTTP_PORT, () => {
        console.log(`\n🌐 HTTPS (fingerprint)  →  https://${HOST}:${HTTP_PORT}/fingerprint`);
        console.log(`⚡ WebTransport          →  https://${HOST}:${WT_PORT}`);
    });

    const h3Server = new Http3Server({
        host: HOST,
        port: WT_PORT,
        secret: "rt-benchmark-secret",
        cert: certificate.cert,
        privKey: certificate.private,
    });

    h3Server.startServer();

    let isKilled = false;
    const shutdown = (signal) => {
        console.log(`\nReceived ${signal}, shutting down...`);
        isKilled = true;
        h3Server.stopServer();
        httpsServer.close();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    try {
        const sessionStream = await h3Server.sessionStream("/");
        const sessionReader = sessionStream.getReader();

        console.log("\nWaiting for WebTransport connections...\n");

        while (!isKilled) {
            const { done, value: session } = await sessionReader.read();
            if (done) break;
            handleSession(session);
        }
    } catch (e) {
        console.error("Session stream error:", e);
    }
}

main().catch(console.error);
