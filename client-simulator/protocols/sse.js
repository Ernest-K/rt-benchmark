// protocols/sse.js
// SSE is server→client only.  
// Echo test:   client POSTs to /echo/:id,  server replies via SSE stream.
// Broadcast:   client POSTs to /broadcast, server pushes to all SSE streams.
//
// Exported interface (same shape for every protocol module):
//   connectEcho(id, config)      → { connectionTimeMs, send, onMessage, close }
//   connectBroadcast(id, config) → { connectionTimeMs, send, onBroadcast, close }

import http from 'http';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseBaseUrl(url) {
    const u = new URL(url);
    return { hostname: u.hostname, port: parseInt(u.port || '80', 10) };
}

/**
 * Open an SSE stream to GET /<path> and return the raw ServerResponse.
 * Returns { req, res } and calls onEvent(data) for each SSE data line.
 */
function openSSE(hostname, port, urlPath, onEvent) {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname, port, path: urlPath, method: 'GET',
            headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' } }, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`SSE HTTP ${res.statusCode}`));
                res.resume();
                return;
            }
            let buf = '';
            res.on('data', chunk => {
                buf += chunk.toString();
                const lines = buf.split('\n');
                buf = lines.pop();
                let data = null;
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        data = line.slice(6);
                    } else if (line === '' && data !== null) {
                        onEvent(data);
                        data = null;
                    }
                }
            });
            resolve(req);
        });
        req.on('error', reject);
        req.end();
    });
}

/**
 * Send an HTTP POST and return when the response is fully consumed.
 */
function post(hostname, port, urlPath, bodyStr) {
    return new Promise((resolve, reject) => {
        const body = Buffer.from(bodyStr);
        const req = http.request({
            hostname, port, path: urlPath, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
        }, (res) => {
            res.resume();
            res.on('end', resolve);
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ── Echo ──────────────────────────────────────────────────────────────────────

export async function connectEcho(id, config) {
    const { hostname, port } = parseBaseUrl(config.SSE_BASE_URL);
    const connectionStart = process.hrtime.bigint();

    let messageHandler = null;

    const req = await openSSE(hostname, port, `/events/${id}`, (data) => {
        if (messageHandler) messageHandler(data);
    });

    const connectionTimeMs = Number(process.hrtime.bigint() - connectionStart) / 1_000_000;

    return {
        connectionTimeMs,

        /** Send a payload string; server echoes it back via SSE. */
        send(payload) {
            // Fire-and-forget POST — timing starts before this call
            post(hostname, port, `/echo/${id}`, payload).catch(() => {});
        },

        onMessage(handler) {
            messageHandler = handler;
        },

        close() {
            req.destroy();
        },
    };
}

// ── Broadcast ─────────────────────────────────────────────────────────────────

export async function connectBroadcast(id, config) {
    const { hostname, port } = parseBaseUrl(config.SSE_BASE_URL);
    const connectionStart = process.hrtime.bigint();

    let broadcastHandler = null;

    const req = await openSSE(hostname, port, `/events/${id}`, (data) => {
        if (broadcastHandler) broadcastHandler(data);
    });

    const connectionTimeMs = Number(process.hrtime.bigint() - connectionStart) / 1_000_000;

    return {
        connectionTimeMs,

        /** Only called by the designated sender client (id === 0). */
        send(payload) {
            post(hostname, port, '/broadcast', payload).catch(() => {});
        },

        onBroadcast(handler) {
            broadcastHandler = handler;
        },

        close() {
            req.destroy();
        },
    };
}
