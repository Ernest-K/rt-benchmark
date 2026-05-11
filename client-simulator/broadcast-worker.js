import { getLocalTimestamp } from "./utils.js";

const { clientIds, config, protocolName } = JSON.parse(process.env.WORKER_DATA);
const protocol = await import(`./protocols/${protocolName}.js`);

const latencyBuffer = [];
const activeClients = [];

for (const id of clientIds) {
    let client;
    try {
        client = await protocol.connectBroadcast(id, config);
    } catch (err) {
        process.send({ type: "log", text: `❌ Client ${id} failed: ${err.message}` });
        continue;
    }

    activeClients.push({ id, client });

    if (id !== 0) {
        client.onBroadcast((message) => {
            try {
                const data = JSON.parse(message);
                const latencyMs = Number(process.hrtime.bigint() - BigInt(data.sendTime)) / 1_000_000;
                latencyBuffer.push({
                    timestamp: getLocalTimestamp(),
                    sender_id: data.senderId,
                    receiver_id: id,
                    broadcast_latency_ms: latencyMs.toFixed(3),
                });
            } catch (_) {}
        });
    }

    await new Promise((r) => setTimeout(r, config.CLIENT_CONNECT_DELAY_MS));
}

process.send({ type: "ready", count: activeClients.length });

let senderInterval = null;

process.on("message", async (msg) => {
    if (msg === "start") {
        // Sender jest zawsze client 0 — może być w dowolnym workerze
        const sender = activeClients.find((c) => c.id === 0);
        if (sender) {
            senderInterval = setInterval(() => {
                const sendTime = process.hrtime.bigint();
                sender.client.send(
                    JSON.stringify({
                        senderId: 0,
                        sendTime: sendTime.toString(),
                    }),
                );
            }, config.MESSAGE_INTERVAL_MS);
        }
    }

    if (msg === "stop") {
        if (senderInterval) clearInterval(senderInterval);
        for (const { client } of activeClients) {
            try {
                client.close();
            } catch (_) {}
        }
        process.send({ type: "results", latencyBuffer });
    }
});
