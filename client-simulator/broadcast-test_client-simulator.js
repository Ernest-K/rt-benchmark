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

import { fork } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { CONFIG } from "./config.js";
import { getLocalTimestamp, sleep, makeCsvWriter } from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NUM_WORKERS = Math.ceil(CONFIG.NUM_CLIENTS / 100);
const PER_WORKER = Math.ceil(CONFIG.NUM_CLIENTS / NUM_WORKERS);

// ── Protocol client ───────────────────────────────────────────────────────────
const protocolModule = await import(`./protocols/${CONFIG.PROTOCOL}.js`);

// ── CSV writer ────────────────────────────────────────────────────────────────
const broadcastDir = path.resolve(__dirname, CONFIG.OUTPUT_DIR, "broadcast-test");

const latencyWriter = makeCsvWriter(path.join(broadcastDir, `broadcast-latency_${CONFIG.SERVER_ID}_${CONFIG.NUM_CLIENTS}clients.csv`), [
    { id: "timestamp", title: "TIMESTAMP" },
    { id: "sender_id", title: "SENDER_ID" },
    { id: "receiver_id", title: "RECEIVER_ID" },
    { id: "broadcast_latency_ms", title: "BROADCAST_LATENCY_MS" },
]);

const latencyBuffer = [];

// ── Active connections ────────────────────────────────────────────────────────
const activeClients = [];

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`\n🚀 Broadcast Test — Protocol: ${CONFIG.PROTOCOL} | Clients: ${CONFIG.NUM_CLIENTS} | Workers: ${NUM_WORKERS}`);

    const workers = [];
    const allLatency = [];

    for (let w = 0; w < NUM_WORKERS; w++) {
        const start = w * PER_WORKER;
        const end = Math.min(start + PER_WORKER, CONFIG.NUM_CLIENTS);
        const clientIds = Array.from({ length: end - start }, (_, i) => start + i);

        await new Promise((resolve, reject) => {
            const worker = fork(path.join(__dirname, "broadcast-worker.js"), [], {
                env: {
                    ...process.env,
                    WORKER_DATA: JSON.stringify({
                        clientIds,
                        config: CONFIG,
                        protocolName: CONFIG.PROTOCOL,
                    }),
                },
            });

            workers.push(worker);

            worker.on("message", (msg) => {
                if (msg.type === "log") console.log(msg.text);
                if (msg.type === "ready") resolve(msg.count);
                if (msg.type === "results") {
                    for (const r of msg.latencyBuffer) allLatency.push(r);
                }
            });
            worker.on("error", reject);
            worker.on("exit", (code) => {
                if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
            });
        });
    }

    console.log(`✅ Clients connected. Starting broadcast...\n`);
    for (const w of workers) w.send("start");

    await sleep(CONFIG.TEST_DURATION_SECONDS * 1000);

    console.log("\n⌛ Test finished. Collecting results...");

    await Promise.all(
        workers.map(
            (w) =>
                new Promise((resolve) => {
                    w.on("message", (msg) => {
                        if (msg.type === "results") resolve();
                    });
                    w.send("stop");
                }),
        ),
    );

    console.log("💾 Saving results...");
    await latencyWriter.writeRecords(allLatency);

    for (const w of workers) w.kill();

    console.log("✅ Broadcast test complete.\n");
    process.exit(0);
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
