"use strict";
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const pidusage = require("pidusage");
const os = require("os");

// ── Args ──────────────────────────────────────────────────────────────────────
const serverId = process.argv[2];
const clientLoad = process.argv[3];
const outputDir = process.argv[4] || path.join(__dirname, "..", "results", "echo-test");

if (!serverId || !clientLoad) {
    console.error("Usage: node echo-test_index.js <server-id> <num-clients> [output-dir]");
    console.error("Example: node echo-test_index.js websocket 100");
    process.exit(1);
}

const PORT = 8081;

// ── Output ────────────────────────────────────────────────────────────────────
fs.mkdirSync(outputDir, { recursive: true });

const throughputCsvWriter = createCsvWriter({
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

// ── Resource monitoring ───────────────────────────────────────────────────────
const resourceCsvWriter = createCsvWriter({
    path: path.join(outputDir, `resources_${serverId}_${clientLoad}clients.csv`),
    header: [
        { id: "timestamp", title: "TIMESTAMP" },
        { id: "connections", title: "ACTIVE_CONNECTIONS" },
        { id: "cpu_percent", title: "CPU_PERCENT" },
        { id: "rss_mb", title: "RSS_MB" },
        { id: "heap_used_mb", title: "HEAP_USED_MB" },
        { id: "external_mb", title: "EXTERNAL_MB" },
    ],
});

let prevCpu = process.cpuUsage();
const MONITOR_INTERVAL_MS = 1000;

setInterval(async () => {
    const stats = await pidusage(process.pid);
    const mem = process.memoryUsage();

    const record = {
        timestamp: getLocalTimestamp(),
        connections: getActiveConnections(),
        cpu_percent: (stats.cpu / os.cpus().length).toFixed(2), // realny % z OS
        rss_mb: (stats.memory / 1024 / 1024).toFixed(2), // też z OS
        heap_used_mb: (mem.heapUsed / 1024 / 1024).toFixed(2),
        external_mb: (mem.external / 1024 / 1024).toFixed(2),
    };

    resourceCsvWriter.writeRecords([record]);
    console.log(`CPU: ${record.cpu_percent}%  RSS: ${record.rss_mb}MB  Conn: ${record.connections}`);
}, MONITOR_INTERVAL_MS);

const getActiveConnections = () => wss.clients.size;

// ── WebSocket Server ──────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ port: PORT });

wss.on("connection", (ws) => {
    console.log(`✅ Client connected (total: ${wss.clients.size})`);

    ws.on("message", (message) => {
        messageCounter++;
        ws.send(message.toString());
    });

    ws.on("close", () => {
        console.log(`❌ Client disconnected (total: ${wss.clients.size})`);
    });

    ws.on("error", (err) => {
        console.error("WS error:", err.message);
    });
});

console.log(`🚀 WebSocket Echo server  →  ws://localhost:${PORT}`);
console.log(`📝 Throughput log         →  throughput_${serverId}_${clientLoad}clients.csv`);

process.on("SIGINT", () => {
    wss.close();
    process.exit(0);
});
process.on("SIGTERM", () => {
    wss.close();
    process.exit(0);
});
