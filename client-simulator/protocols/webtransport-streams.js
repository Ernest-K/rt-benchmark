// protocols/webtransport-streams.js
// Uses HTTP/3 WebTransport bidirectional streams for echo and broadcast.
// Each client creates one bidi stream; messages are sent/received on that stream.

import { WebTransport } from '@fails-components/webtransport';

// NODE_TLS_REJECT_UNAUTHORIZED=0 is needed only for the fingerprint fetch (HTTPS self-signed)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const enc = new TextDecoder();
const CONNECT_TIMEOUT_MS = 20_000;

async function getFingerprintOptions(httpUrl) {
    try {
        const res = await fetch(`${httpUrl}/fingerprint`);
        const fpBytes = await res.json();
        if (Array.isArray(fpBytes) && fpBytes.length === 32) {
            return {
                serverCertificateHashes: [{
                    algorithm: 'sha-256',
                    value: Buffer.from(fpBytes),
                }],
            };
        }
    } catch (_) {}
    return undefined;
}

async function connectWT(config) {
    // Fingerprint is fetched once per process — cache it
    if (!connectWT._optionsPromise) {
        connectWT._optionsPromise = getFingerprintOptions(config.WEBTRANSPORT_HTTP_URL);
    }
    const options = await connectWT._optionsPromise;

    const transport = new WebTransport(config.WEBTRANSPORT_URL, options);

    await Promise.race([
        transport.ready,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('WebTransport connect timeout')), CONNECT_TIMEOUT_MS)),
    ]);

    return transport;
}

// ── Echo ──────────────────────────────────────────────────────────────────────

export async function connectEcho(id, config) {
    const connectionStart = process.hrtime.bigint();
    const transport = await connectWT(config);
    const connectionTimeMs = Number(process.hrtime.bigint() - connectionStart) / 1_000_000;

    // One bidirectional stream per client
    const stream = await transport.createBidirectionalStream();
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();

    let messageHandler = null;

    // Read loop
    (async () => {
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (messageHandler) messageHandler(enc.decode(value));
            }
        } catch (_) {}
    })();

    return {
        connectionTimeMs,
        send(payload) {
            writer.write(new TextEncoder().encode(payload)).catch(() => {});
        },
        onMessage(handler) { messageHandler = handler; },
        close() { try { transport.close(); } catch (_) {} },
    };
}

// ── Broadcast ─────────────────────────────────────────────────────────────────

export async function connectBroadcast(id, config) {
    const connectionStart = process.hrtime.bigint();
    const transport = await connectWT(config);
    const connectionTimeMs = Number(process.hrtime.bigint() - connectionStart) / 1_000_000;

    // Open a bidi stream — server will write broadcast messages on the read side
    const stream = await transport.createBidirectionalStream();
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();

    let broadcastHandler = null;

    (async () => {
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (broadcastHandler) broadcastHandler(enc.decode(value));
            }
        } catch (_) {}
    })();

    return {
        connectionTimeMs,
        send(payload) {
            writer.write(new TextEncoder().encode(payload)).catch(() => {});
        },
        onBroadcast(handler) { broadcastHandler = handler; },
        close() { try { transport.close(); } catch (_) {} },
    };
}
