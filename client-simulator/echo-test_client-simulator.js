// echo-test_client-simulator.js
//
// Measures:
//   - Connection Time (ms)  — time to establish the protocol connection
//   - RTT (ms)              — round-trip time per echo message
//
// Usage (via environment variables):
//   PROTOCOL=websocket SERVER_ID=websocket NUM_CLIENTS=100 node echo-test_client-simulator.js

import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from './config.js';
import { getLocalTimestamp, sleep, makeCsvWriter, pLimit } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Protocol client ───────────────────────────────────────────────────────────
const protocolModule = await import(`./protocols/${CONFIG.PROTOCOL}.js`);

// ── CSV writers ───────────────────────────────────────────────────────────────
const echoDir = path.resolve(__dirname, CONFIG.OUTPUT_DIR, 'echo-test');

const rttWriter = makeCsvWriter(
    path.join(echoDir, `rtt_${CONFIG.SERVER_ID}_${CONFIG.NUM_CLIENTS}clients.csv`),
    [
        { id: 'timestamp',        title: 'TIMESTAMP' },
        { id: 'client_id',        title: 'CLIENT_ID' },
        { id: 'round_trip_time_ms', title: 'RTT_MS' },
    ],
);

const connWriter = makeCsvWriter(
    path.join(echoDir, `conn-time_${CONFIG.SERVER_ID}_${CONFIG.NUM_CLIENTS}clients.csv`),
    [
        { id: 'timestamp',          title: 'TIMESTAMP' },
        { id: 'client_id',          title: 'CLIENT_ID' },
        { id: 'connection_time_ms', title: 'CONNECTION_TIME_MS' },
    ],
);

// ── Active connections (for cleanup) ──────────────────────────────────────────
const activeClients = [];

// ── Client factory ────────────────────────────────────────────────────────────
async function createEchoClient(id) {
    let client;
    try {
        client = await protocolModule.connectEcho(id, CONFIG);
    } catch (err) {
        console.error(`❌ Client ${id} failed to connect: ${err.message}`);
        return null;
    }

    activeClients.push(client);

    // Log connection time
    connWriter.writeRecords([{
        timestamp:          getLocalTimestamp(),
        client_id:          id,
        connection_time_ms: client.connectionTimeMs.toFixed(3),
    }]).catch(() => {});

    // Echo loop: on message → record RTT → immediately send next
    let sendTime;

    client.onMessage((msg) => {
        const rttMs = Number(process.hrtime.bigint() - sendTime) / 1_000_000;
        rttWriter.writeRecords([{
            timestamp:          getLocalTimestamp(),
            client_id:          id,
            round_trip_time_ms: rttMs.toFixed(3),
        }]).catch(() => {});

        // Send next message immediately after receiving echo
        sendNext();
    });

    function sendNext() {
        sendTime = process.hrtime.bigint();
        const payload = JSON.stringify({ sendTime: sendTime.toString(), clientId: id });
        client.send(payload);
    }

    // Kick off the first message
    sendNext();

    return client;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`\n🚀 Echo Test — Protocol: ${CONFIG.PROTOCOL}  |  Clients: ${CONFIG.NUM_CLIENTS}`);
    console.log(`⏳ Duration: ${CONFIG.TEST_DURATION_SECONDS}s  |  Delay between connects: ${CONFIG.CLIENT_CONNECT_DELAY_MS}ms\n`);

    const ids = Array.from({ length: CONFIG.NUM_CLIENTS }, (_, i) => i);

    // WebRTC needs a lower concurrency during the expensive SDP handshake
    const concurrency = CONFIG.PROTOCOL === 'webrtc'
        ? CONFIG.WEBRTC_CONCURRENCY
        : CONFIG.NUM_CLIENTS;

    // Connect all clients (with optional delay between each)
    const connectionPromises = [];
    for (let i = 0; i < CONFIG.NUM_CLIENTS; i++) {
        connectionPromises.push(
            (async (id) => {
                if (CONFIG.CLIENT_CONNECT_DELAY_MS > 0 && CONFIG.PROTOCOL !== 'webrtc') {
                    await sleep(id * CONFIG.CLIENT_CONNECT_DELAY_MS);
                }
                return createEchoClient(id);
            })(i)
        );

        // For WebRTC: limit concurrent handshakes
        if (CONFIG.PROTOCOL === 'webrtc' && (i + 1) % concurrency === 0) {
            await Promise.allSettled(connectionPromises.slice(i + 1 - concurrency, i + 1));
        }
    }

    const results = await Promise.allSettled(connectionPromises);
    const succeeded = results.filter(r => r.status === 'fulfilled' && r.value !== null).length;

    console.log(`✅ ${succeeded}/${CONFIG.NUM_CLIENTS} clients connected. Echo test running...\n`);

    // Run for the configured duration
    await sleep(CONFIG.TEST_DURATION_SECONDS * 1000);

    console.log('\n⌛ Test duration finished. Closing all clients...');
    for (const c of activeClients) {
        try { c.close(); } catch (_) {}
    }

    console.log('✅ Echo test complete.\n');
    // Give CSV writers a moment to flush
    await sleep(1500);
    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
