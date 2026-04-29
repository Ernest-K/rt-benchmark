#!/usr/bin/env node
// run-benchmark.js
//
// Orchestrates the full benchmark suite:
//   1. For each protocol × client load → start server, run client simulator, stop server
//   2. Repeats each scenario RUNS_PER_SCENARIO times (default: 3)
//   3. All CSV results land in ./results/
//
// Usage:
//   node run-benchmark.js [--test echo|broadcast|both] [--runs 3] [--loads 100,200,400,600,800,1000]
//
// Per-protocol quick run:
//   node run-benchmark.js --protocol websocket --test echo --loads 100,200

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(flag, def) {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : def;
}

const TEST_MODE    = getArg('--test',     'both');   // echo | broadcast | both
const RUNS         = parseInt(getArg('--runs',  '3'), 10);
const LOAD_ARG     = getArg('--loads',   '100,200,400,600,800,1000');
const PROTO_FILTER = getArg('--protocol', '');       // filter to single protocol
const DRY_RUN      = args.includes('--dry-run');
const CLIENT_LOADS = LOAD_ARG.split(',').map(Number);
const TEST_DURATION_SECONDS = parseInt(getArg('--duration', '60'), 10);

// ── Protocol definitions ──────────────────────────────────────────────────────
const PROTOCOLS = [
    {
        id:           'sse',
        label:        'SSE',
        protocol:     'sse',
        serverDir:    'server-sse',
        echoCmd:      ['node', 'echo-test_index.js'],
        broadcastCmd: ['node', 'broadcast-test_index.js'],
    },
    {
        id:           'websocket',
        label:        'WebSocket (ws)',
        protocol:     'websocket',
        serverDir:    'server-websocket',
        echoCmd:      ['node', 'echo-test_index.js'],
        broadcastCmd: ['node', 'broadcast-test_index.js'],
    },
    {
        id:           'webrtc',
        label:        'WebRTC (node-datachannel)',
        protocol:     'webrtc',
        serverDir:    'server-webrtc',
        echoCmd:      ['node', 'echo-test_index.js'],
        broadcastCmd: ['node', 'broadcast-test_index.js'],
    },
    {
        id:           'webtransport-streams',
        label:        'WebTransport Streams',
        protocol:     'webtransport-streams',
        serverDir:    'server-webtransport',
        echoCmd:      ['node', 'echo-test_index.js'],
        broadcastCmd: ['node', 'broadcast-test_index.js'],
        esm:          true,
    },
    {
        id:           'webtransport-datagrams',
        label:        'WebTransport Datagrams',
        protocol:     'webtransport-datagrams',
        serverDir:    'server-webtransport',
        echoCmd:      ['node', 'echo-test_index.js'],
        broadcastCmd: ['node', 'broadcast-test_index.js'],
        esm:          true,
    },
];

const activeProtocols = PROTO_FILTER
    ? PROTOCOLS.filter(p => p.id === PROTO_FILTER || p.protocol === PROTO_FILTER)
    : PROTOCOLS;

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

/**
 * Spawn a process and return { proc, kill }.
 * stdout/stderr are piped to the parent process with a prefix label.
 */
function spawnProc(cmd, args, cwd, env = {}) {
    const label = `[${path.basename(cwd)}]`;
    const proc = spawn(cmd, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', d => process.stdout.write(`${label} ${d}`));
    proc.stderr.on('data', d => process.stderr.write(`${label} ${d}`));
    return proc;
}

/**
 * Wait for the process to exit (or reject after timeout).
 */
function waitForExit(proc, timeoutMs) {
    return new Promise((resolve, reject) => {
        const t = timeoutMs
            ? setTimeout(() => { proc.kill('SIGTERM'); reject(new Error('Timeout')); }, timeoutMs)
            : null;
        proc.on('exit', (code) => {
            if (t) clearTimeout(t);
            resolve(code);
        });
        proc.on('error', reject);
    });
}

/**
 * Kill a process gracefully (SIGTERM → 3 s → SIGKILL).
 */
async function killProc(proc) {
    if (!proc || proc.exitCode !== null) return;
    proc.kill('SIGTERM');
    await sleep(3000);
    if (proc.exitCode === null) {
        proc.kill('SIGKILL');
        await sleep(500);
    }
}

// ── Single test run ───────────────────────────────────────────────────────────
async function runScenario({ proto, testType, numClients, run }) {
    const serverDir = path.join(__dirname, proto.serverDir);
    const clientDir = path.join(__dirname, 'client-simulator');

    const serverCmd = testType === 'echo' ? proto.echoCmd : proto.broadcastCmd;
    const serverArgs = testType === 'echo'
        ? [...serverCmd.slice(1), proto.id, String(numClients)]
        : [...serverCmd.slice(1)];

    const clientScript = testType === 'echo'
        ? 'echo-test_client-simulator.js'
        : 'broadcast-test_client-simulator.js';

    const env = {
        PROTOCOL:               proto.protocol,
        SERVER_ID:              proto.id,
        NUM_CLIENTS:            String(numClients),
        TEST_DURATION_SECONDS:  String(TEST_DURATION_SECONDS),
        OUTPUT_DIR:             path.join(__dirname, 'results'),
    };

    log(`▶  ${proto.label} | ${testType} | ${numClients} clients | run ${run}/${RUNS}`);

    if (DRY_RUN) {
        log(`   [dry-run] server: ${serverCmd[0]} ${serverArgs.join(' ')}`);
        log(`   [dry-run] client: node ${clientScript}`);
        await sleep(200);
        return;
    }

    // Start server
    const serverProc = spawnProc(serverCmd[0], serverArgs, serverDir);

    // Give server time to bind port
    await sleep(proto.id.startsWith('webtransport') ? 3000 : 1500);

    // Check server started OK
    if (serverProc.exitCode !== null) {
        log(`❌ Server exited early (code ${serverProc.exitCode})`);
        return;
    }

    try {
        // Run client simulator
        const clientProc = spawnProc('node', [clientScript], clientDir, env);
        const exitCode = await waitForExit(
            clientProc,
            (TEST_DURATION_SECONDS + 30) * 1000,
        );
        if (exitCode !== 0) log(`⚠️  Client exited with code ${exitCode}`);
    } finally {
        await killProc(serverProc);
        // Brief pause between runs
        await sleep(2000);
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    fs.mkdirSync(path.join(__dirname, 'results', 'echo-test'),      { recursive: true });
    fs.mkdirSync(path.join(__dirname, 'results', 'broadcast-test'), { recursive: true });

    const testTypes = TEST_MODE === 'both' ? ['echo', 'broadcast']
        : TEST_MODE === 'echo'             ? ['echo']
        :                                    ['broadcast'];

    log('═'.repeat(70));
    log(`Real-Time Protocol Benchmark`);
    log(`Protocols : ${activeProtocols.map(p => p.label).join(', ')}`);
    log(`Tests     : ${testTypes.join(', ')}`);
    log(`Loads     : ${CLIENT_LOADS.join(', ')} clients`);
    log(`Runs/test : ${RUNS}`);
    log(`Duration  : ${TEST_DURATION_SECONDS}s per run`);
    log('═'.repeat(70) + '\n');

    let total = 0;
    let done  = 0;

    for (const proto of activeProtocols) {
        for (const testType of testTypes) {
            for (const numClients of CLIENT_LOADS) {
                total += RUNS;
            }
        }
    }

    for (const proto of activeProtocols) {
        for (const testType of testTypes) {
            for (const numClients of CLIENT_LOADS) {
                for (let run = 1; run <= RUNS; run++) {
                    await runScenario({ proto, testType, numClients, run });
                    done++;
                    log(`Progress: ${done}/${total} scenarios complete\n`);
                }
            }
        }
    }

    log('🎉 Benchmark complete! Results saved in ./results/');
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
