// echo-test_client-simulator.js
//
// Measures:
//   - Connection Time (ms)  — time to establish the protocol connection
//   - RTT (ms)              — round-trip time per echo message
//
// Usage (via environment variables):
//   PROTOCOL=websocket SERVER_ID=websocket NUM_CLIENTS=100 node echo-test_client-simulator.js

import { fork } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { CONFIG } from "./config.js";
import { getLocalTimestamp, sleep, makeCsvWriter, pLimit } from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ile wątków — 1 wątek na ~100 klientów
const NUM_WORKERS = Math.ceil(CONFIG.NUM_CLIENTS / 100);
const PER_WORKER = Math.ceil(CONFIG.NUM_CLIENTS / NUM_WORKERS);

// ── Protocol client ───────────────────────────────────────────────────────────
const protocolModule = await import(`./protocols/${CONFIG.PROTOCOL}.js`);

// ── CSV writers ───────────────────────────────────────────────────────────────
const echoDir = path.resolve(__dirname, CONFIG.OUTPUT_DIR, "echo-test");

const rttWriter = makeCsvWriter(path.join(echoDir, `rtt_${CONFIG.SERVER_ID}_${CONFIG.NUM_CLIENTS}clients.csv`), [
    { id: "timestamp", title: "TIMESTAMP" },
    { id: "client_id", title: "CLIENT_ID" },
    { id: "round_trip_time_ms", title: "RTT_MS" },
]);

const connWriter = makeCsvWriter(path.join(echoDir, `conn-time_${CONFIG.SERVER_ID}_${CONFIG.NUM_CLIENTS}clients.csv`), [
    { id: "timestamp", title: "TIMESTAMP" },
    { id: "client_id", title: "CLIENT_ID" },
    { id: "connection_time_ms", title: "CONNECTION_TIME_MS" },
]);

// ── Active connections (for cleanup) ──────────────────────────────────────────
const activeClients = [];

const rttBuffer = [];
const connBuffer = [];

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

    // Zapisuj co N-tą wiadomość żeby nie wysadzić RAM-u
    let msgCount = 0;
    client.onMessage((msg) => {
        const rttMs = Number(process.hrtime.bigint() - client._sendTime) / 1_000_000;
        // Tylko push do bufora, zero I/O na gorącej ścieżce
        if (++msgCount % 10 === 0) {
            rttBuffer.push({
                timestamp: getLocalTimestamp(),
                client_id: id,
                round_trip_time_ms: rttMs.toFixed(3),
            });
        }
        client._sendNext();
    });

    connBuffer.push({
        timestamp: getLocalTimestamp(),
        client_id: id,
        connection_time_ms: client.connectionTimeMs.toFixed(3),
    });

    // Przechowaj sendNext na kliencie żeby handler mógł go wywołać
    client._sendNext = () => {
        client._sendTime = process.hrtime.bigint();
        client.send(JSON.stringify({ sendTime: client._sendTime.toString(), clientId: id }));
    };

    return client;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`\n🚀 Echo Test — Protocol: ${CONFIG.PROTOCOL} | Clients: ${CONFIG.NUM_CLIENTS} | Workers: ${NUM_WORKERS}`);

    const workers = [];
    const allRtt = [];
    const allConn = [];

    // Wystartuj workery
    for (let w = 0; w < NUM_WORKERS; w++) {
        const start = w * PER_WORKER;
        const end = Math.min(start + PER_WORKER, CONFIG.NUM_CLIENTS);
        const clientIds = Array.from({ length: end - start }, (_, i) => start + i);

        await new Promise((resolve, reject) => {
            const worker = fork(
                path.join(__dirname, "worker.js"),
                [], // args
                {
                    env: { ...process.env },
                    // Przekaż workerData przez env zamiast workerData:
                    env: {
                        ...process.env,
                        WORKER_DATA: JSON.stringify({
                            clientIds,
                            config: CONFIG,
                            protocolName: CONFIG.PROTOCOL,
                        }),
                    },
                },
            );

            workers.push(worker);

            worker.on("message", (msg) => {
                if (msg.type === "log") console.log(msg.text);
                if (msg.type === "ready") resolve(msg.count);
                if (msg.type === "results") {
                    for (const r of msg.rttBuffer) allRtt.push(r);
                    for (const r of msg.connBuffer) allConn.push(r);
                }
            });
            worker.on("error", reject);
            worker.on("exit", (code) => {
                if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
            });
        });
    }

    const succeeded = workers.length * PER_WORKER;
    console.log(`✅ ~${succeeded}/${CONFIG.NUM_CLIENTS} clients connected. Starting echo...\n`);

    // Daj sygnał start wszystkim workerom
    for (const w of workers) w.send("start");

    await sleep(CONFIG.TEST_DURATION_SECONDS * 1000);

    console.log("\n⌛ Test finished. Collecting results...");

    // Zbierz wyniki ze wszystkich workerów
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
    await rttWriter.writeRecords(allRtt);
    await connWriter.writeRecords(allConn);

    for (const w of workers) w.kill();

    console.log("✅ Echo test complete.\n");
    process.exit(0);
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
