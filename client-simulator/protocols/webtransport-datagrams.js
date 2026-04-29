// protocols/webtransport-datagrams.js
// Uses HTTP/3 WebTransport unreliable datagrams for echo and broadcast.
// Messages are sent as datagrams; server echoes/broadcasts as datagrams.

import { WebTransport } from '@fails-components/webtransport';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const dec = new TextDecoder();
const enc = new TextEncoder();
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

    const writer = transport.datagrams.writable.getWriter();
    const reader = transport.datagrams.readable.getReader();

    let messageHandler = null;

    // Read loop
    (async () => {
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (messageHandler) messageHandler(dec.decode(value));
            }
        } catch (_) {}
    })();

    return {
        connectionTimeMs,
        send(payload) {
            writer.write(enc.encode(payload)).catch(() => {});
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

    const writer = transport.datagrams.writable.getWriter();
    const reader = transport.datagrams.readable.getReader();

    let broadcastHandler = null;

    (async () => {
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (broadcastHandler) broadcastHandler(dec.decode(value));
            }
        } catch (_) {}
    })();

    return {
        connectionTimeMs,
        send(payload) {
            writer.write(enc.encode(payload)).catch(() => {});
        },
        onBroadcast(handler) { broadcastHandler = handler; },
        close() { try { transport.close(); } catch (_) {} },
    };
}
