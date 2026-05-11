import { getLocalTimestamp } from "./utils.js";

const { clientIds, config, protocolName } = JSON.parse(process.env.WORKER_DATA);
const protocol = await import(`./protocols/${protocolName}.js`);

const TEST_WARMUP_SECONDS = 5;

const rttBuffer = [];
const connBuffer = [];

const activeClients = [];

async function createEchoClient(id) {
    let client;
    try {
        client = await protocol.connectEcho(id, config);
    } catch (err) {
        process.send({ type: "log", text: `❌ Client ${id} failed: ${err.message}` });
        return null;
    }

    activeClients.push(client);

    connBuffer.push({
        timestamp: getLocalTimestamp(),
        client_id: id,
        connection_time_ms: client.connectionTimeMs.toFixed(3),
    });

    const startTime = Date.now();

    client.onMessage(() => {
        const rttMs = Number(process.hrtime.bigint() - client._sendTime) / 1_000_000;
        if (Date.now() - startTime > TEST_WARMUP_SECONDS * 1000) {
            rttBuffer.push({
                timestamp: getLocalTimestamp(),
                client_id: id,
                round_trip_time_ms: rttMs.toFixed(3),
            });
        }
        client._sendNext();
    });

    client._sendNext = () => {
        client._sendTime = process.hrtime.bigint();
        client.send(JSON.stringify({ sendTime: client._sendTime.toString(), clientId: id }));
    };

    return client;
}

// Połącz wszystkich w tym workerze
for (const id of clientIds) {
    await createEchoClient(id);
    await new Promise((r) => setTimeout(r, config.CLIENT_CONNECT_DELAY_MS));
}

process.send({ type: "ready", count: activeClients.filter(Boolean).length });

let started = false;

process.on("message", async (msg) => {
    if (msg === "start" && !started) {
        started = true;
        for (const c of activeClients) {
            if (c) c._sendNext();
        }
    }

    if (msg === "stop") {
        for (const c of activeClients) {
            try {
                c.close();
            } catch (_) {}
        }
        process.send({ type: "results", rttBuffer, connBuffer });
    }
});
