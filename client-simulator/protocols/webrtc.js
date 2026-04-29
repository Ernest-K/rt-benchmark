// protocols/webrtc.js
// WebRTC DataChannel client using `node-datachannel`.
// Signaling is done via HTTP POST to the server's signaling endpoint.
//
// Flow per client:
//  1. Create PeerConnection + DataChannel (triggers offer generation)
//  2. Collect local SDP (offer) and ICE candidates (wait 500 ms)
//  3. POST { sdp, type, candidates } → server → receive { sdp, type, candidates }
//  4. Set remote description + add remote candidates
//  5. Wait for DataChannel 'open' event

import nodeDataChannel from "node-datachannel";

// Silence node-datachannel internal logs
nodeDataChannel.initLogger("Error", () => {});

const CANDIDATE_GATHER_MS = 500; // ms to wait for local ICE candidates
const DC_OPEN_TIMEOUT_MS = 15_000;

async function gatherLocalSDP(pc) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("SDP gather timeout")), 8000);
        pc.onLocalDescription((sdp, type) => {
            clearTimeout(t);
            resolve({ sdp, type });
        });
    });
}

async function gatherCandidates(pc) {
    const candidates = [];
    pc.onLocalCandidate((candidate, mid) => candidates.push({ candidate, mid }));
    await new Promise((r) => setTimeout(r, CANDIDATE_GATHER_MS));
    return candidates;
}

async function signal(signalUrl, body) {
    const res = await fetch(`${signalUrl}/signal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Signal HTTP ${res.status}: ${await res.text()}`);
    return res.json();
}

async function buildConnection(id, config) {
    const connectionStart = process.hrtime.bigint();

    const pc = new nodeDataChannel.PeerConnection(`client-${id}`, { iceServers: [] });

    // ⚠️ Listeners PRZED createDataChannel — inaczej event odpala się za wcześnie
    const localDescPromise = new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("SDP gather timeout")), 8000);
        pc.onLocalDescription((sdp, type) => {
            clearTimeout(t);
            resolve({ sdp, type });
        });
    });

    const localCandidates = [];
    pc.onLocalCandidate((candidate, mid) => localCandidates.push({ candidate, mid }));

    // Dopiero teraz — triggeruje generowanie oferty
    const dc = pc.createDataChannel("benchmark");

    // Czekaj na SDP, potem chwilę na kandydatów ICE
    const localDesc = await localDescPromise;
    await new Promise((r) => setTimeout(r, CANDIDATE_GATHER_MS));

    // Wymiana SDP z serwerem
    const answer = await signal(config.WEBRTC_SIGNAL_URL, {
        clientId: id,
        sdp: localDesc.sdp,
        type: localDesc.type,
        candidates: localCandidates,
    });

    pc.setRemoteDescription(answer.sdp, answer.type);
    for (const c of answer.candidates || []) {
        try {
            pc.addRemoteCandidate(c.candidate, c.mid);
        } catch (_) {}
    }

    await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("DC open timeout")), DC_OPEN_TIMEOUT_MS);
        dc.onOpen(() => {
            clearTimeout(t);
            resolve();
        });
        dc.onError((err) => {
            clearTimeout(t);
            reject(new Error(err));
        });
    });

    const connectionTimeMs = Number(process.hrtime.bigint() - connectionStart) / 1_000_000;
    return { pc, dc, connectionTimeMs };
}

// ── Echo ──────────────────────────────────────────────────────────────────────

export async function connectEcho(id, config) {
    const { pc, dc, connectionTimeMs } = await buildConnection(id, config);

    let messageHandler = null;
    dc.onMessage((msg) => {
        if (messageHandler) messageHandler(typeof msg === "string" ? msg : msg.toString());
    });
    dc.onError(() => {});

    return {
        connectionTimeMs,
        send(payload) {
            try {
                dc.sendMessage(payload);
            } catch (_) {}
        },
        onMessage(handler) {
            messageHandler = handler;
        },
        close() {
            try {
                dc.close();
            } catch (_) {}
            try {
                pc.close();
            } catch (_) {}
        },
    };
}

// ── Broadcast ─────────────────────────────────────────────────────────────────

export async function connectBroadcast(id, config) {
    const { pc, dc, connectionTimeMs } = await buildConnection(id, config);

    let broadcastHandler = null;
    dc.onMessage((msg) => {
        if (broadcastHandler) broadcastHandler(typeof msg === "string" ? msg : msg.toString());
    });
    dc.onError(() => {});

    return {
        connectionTimeMs,
        send(payload) {
            try {
                dc.sendMessage(payload);
            } catch (_) {}
        },
        onBroadcast(handler) {
            broadcastHandler = handler;
        },
        close() {
            try {
                dc.close();
            } catch (_) {}
            try {
                pc.close();
            } catch (_) {}
        },
    };
}
