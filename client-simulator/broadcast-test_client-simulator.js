// broadcast-test_client-simulator.js
//
// Measures:
//   - Broadcast Latency (ms) — time from sender sending to each receiver receiving
//
// Client 0 = sender  (sends messages every MESSAGE_INTERVAL_MS)
// Clients 1..N = receivers (measure latency on arrival)
//
// Usage (via environment variables):
//   PROTOCOL=websocket SERVER_ID=websocket NUM_CLIENTS=100 node broadcast-test_client-simulator.js

import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from './config.js';
import { getLocalTimestamp, sleep, makeCsvWriter } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Protocol client ───────────────────────────────────────────────────────────
const protocolModule = await import(`./protocols/${CONFIG.PROTOCOL}.js`);

// ── CSV writer ────────────────────────────────────────────────────────────────
const broadcastDir = path.resolve(__dirname, CONFIG.OUTPUT_DIR, 'broadcast-test');

const latencyWriter = makeCsvWriter(
    path.join(broadcastDir, `broadcast-latency_${CONFIG.SERVER_ID}_${CONFIG.NUM_CLIENTS}clients.csv`),
    [
        { id: 'timestamp',            title: 'TIMESTAMP' },
        { id: 'sender_id',            title: 'SENDER_ID' },
        { id: 'receiver_id',          title: 'RECEIVER_ID' },
        { id: 'broadcast_latency_ms', title: 'BROADCAST_LATENCY_MS' },
    ],
);

// ── Active connections ────────────────────────────────────────────────────────
const activeClients = [];

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`\n🚀 Broadcast Test — Protocol: ${CONFIG.PROTOCOL}  |  Clients: ${CONFIG.NUM_CLIENTS}`);
    console.log(`⏳ Duration: ${CONFIG.TEST_DURATION_SECONDS}s  |  Send interval: ${CONFIG.MESSAGE_INTERVAL_MS}ms\n`);

    // ── Connect all clients ────────────────────────────────────────────────────
    const connectionPromises = [];

    for (let i = 0; i < CONFIG.NUM_CLIENTS; i++) {
        connectionPromises.push(
            (async (id) => {
                // Stagger connects slightly to avoid thundering herd
                if (CONFIG.PROTOCOL !== 'webrtc') {
                    await sleep(id * CONFIG.CLIENT_CONNECT_DELAY_MS);
                } else {
                    // WebRTC: batch connect with concurrency limit
                    await sleep(Math.floor(id / CONFIG.WEBRTC_CONCURRENCY) * 2000);
                }

                try {
                    const client = await protocolModule.connectBroadcast(id, CONFIG);
                    activeClients.push(client);

                    if (id === 0) {
                        // ── Sender client ──────────────────────────────────────
                        console.log(`✅ Sender (client 0) connected`);
                        // Sender does not need to listen for broadcasts
                    } else {
                        // ── Receiver clients ───────────────────────────────────
                        client.onBroadcast((message) => {
                            try {
                                const data = JSON.parse(message);
                                const receiveTime = process.hrtime.bigint();
                                const latencyMs = Number(receiveTime - BigInt(data.sendTime)) / 1_000_000;

                                latencyWriter.writeRecords([{
                                    timestamp:            getLocalTimestamp(),
                                    sender_id:            data.senderId,
                                    receiver_id:          id,
                                    broadcast_latency_ms: latencyMs.toFixed(3),
                                }]).catch(() => {});
                            } catch (_) {}
                        });
                    }

                    return client;
                } catch (err) {
                    console.error(`❌ Client ${id} failed to connect: ${err.message}`);
                    return null;
                }
            })(i)
        );
    }

    const results = await Promise.allSettled(connectionPromises);
    const succeeded = results.filter(r => r.status === 'fulfilled' && r.value !== null).length;
    console.log(`\n✅ ${succeeded}/${CONFIG.NUM_CLIENTS} clients connected. Starting broadcast...\n`);

    // ── Sender loop ────────────────────────────────────────────────────────────
    const sender = activeClients[0];  // client 0 is always the sender
    let sendCount = 0;

    const senderInterval = setInterval(() => {
        if (!sender) return;
        const sendTime = process.hrtime.bigint();
        const payload = JSON.stringify({
            senderId: 0,
            sendTime: sendTime.toString(),
            seq: sendCount++,
        });
        try {
            sender.send(payload);
        } catch (_) {}
    }, CONFIG.MESSAGE_INTERVAL_MS);

    // ── Wait for test duration ────────────────────────────────────────────────
    await sleep(CONFIG.TEST_DURATION_SECONDS * 1000);

    console.log('\n⌛ Test duration finished. Closing all clients...');
    clearInterval(senderInterval);

    for (const c of activeClients) {
        try { c.close(); } catch (_) {}
    }

    console.log('✅ Broadcast test complete.\n');
    await sleep(1500);
    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
