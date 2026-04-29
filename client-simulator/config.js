// config.js — all settings for the client simulator
// Every value can be overridden with an environment variable.

export const CONFIG = {
    // Protocol to test:
    //   'sse' | 'websocket' | 'webrtc' |
    //   'webtransport-streams' | 'webtransport-datagrams'
    PROTOCOL: process.env.PROTOCOL || "webrtc",

    // Identifier used in output CSV filenames  (e.g. "websocket", "sse", "webrtc")
    SERVER_ID: process.env.SERVER_ID || "webrtc",

    // Number of concurrent simulated clients
    NUM_CLIENTS: parseInt(process.env.NUM_CLIENTS || "1", 10),

    // How long each test phase runs (seconds)
    TEST_DURATION_SECONDS: parseInt(process.env.TEST_DURATION_SECONDS || "10", 10),

    // Broadcast test: interval between sender messages (ms)
    MESSAGE_INTERVAL_MS: parseInt(process.env.MESSAGE_INTERVAL_MS || "3000", 10),

    // Delay between spawning each client connection (ms)
    // Helps avoid thundering-herd on connect; lower = faster warmup.
    CLIENT_CONNECT_DELAY_MS: parseInt(process.env.CLIENT_CONNECT_DELAY_MS || "20", 10),

    // For WebRTC: max concurrent handshakes in flight
    WEBRTC_CONCURRENCY: parseInt(process.env.WEBRTC_CONCURRENCY || "30", 10),

    // Output directory (relative to client-simulator/)
    OUTPUT_DIR: process.env.OUTPUT_DIR || "../results",

    // ── Per-protocol server URLs ───────────────────────────────────────────────
    SSE_BASE_URL: process.env.SSE_BASE_URL || "http://localhost:8080",
    WEBSOCKET_URL: process.env.WEBSOCKET_URL || "ws://localhost:8081",
    WEBRTC_SIGNAL_URL: process.env.WEBRTC_SIGNAL_URL || "http://localhost:8082",
    WEBTRANSPORT_URL: process.env.WEBTRANSPORT_URL || "https://localhost:4433",
    WEBTRANSPORT_HTTP_URL: process.env.WEBTRANSPORT_HTTP_URL || "https://localhost:3000",
};
