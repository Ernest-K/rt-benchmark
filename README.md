# Real-Time Protocol Benchmark 🚀📊

Benchmark porównujący wydajność 5 wariantów komunikacji real-time w aplikacjach webowych,
uruchamiany w całości w środowisku **Node.js**.

## Badane protokoły

| ID | Protokół | Transport | Opis |
|----|----------|-----------|------|
| `sse` | **SSE** (Server-Sent Events) | HTTP/1.1 | Jednostronne push serwer→klient; echo przez HTTP POST |
| `websocket` | **WebSocket** (`ws`) | TCP | Pełny duplex, biblioteka `ws` |
| `webrtc` | **WebRTC** (DataChannel) | DTLS/SCTP | P2P data channels via `node-datachannel` |
| `webtransport-streams` | **WebTransport — Streams** | HTTP/3 | Niezawodne strumienie bidi przez QUIC |
| `webtransport-datagrams` | **WebTransport — Datagrams** | HTTP/3 | Zawodne datagramy (niskie opóźnienie) |

## Mierzone metryki

### Echo Test (punkt→punkt)
- **Connection Time (ms)** — czas nawiązania połączenia
- **RTT (ms)** — Round Trip Time (od wysłania do odbioru odpowiedzi)
- **Throughput (msg/s)** — wiadomości przetworzone na sekundę (po stronie serwera)

### Broadcast Test (jeden→wszyscy)
- **Broadcast Latency (ms)** — czas od wysłania wiadomości przez sendera do odebrania przez każdego receivera

## Scenariusze obciążenia

Domyślnie: `100, 200, 400, 600, 800, 1000` klientów jednocześnie,
każdy scenariusz powtarzany **3 razy** (wynik = średnia arytmetyczna).

---

## Struktura projektu

```
rt-benchmark/
├── run-benchmark.js          # Główny orchestrator — uruchamia cały suite
├── package.json              # Root scripts
│
├── server-sse/               # Serwer SSE (Node.js http)
│   ├── echo-test_index.js
│   └── broadcast-test_index.js
│
├── server-websocket/         # Serwer WebSocket (biblioteka `ws`)
│   ├── echo-test_index.js
│   └── broadcast-test_index.js
│
├── server-webrtc/            # Serwer WebRTC signaling + DataChannel (node-datachannel)
│   ├── echo-test_index.js
│   └── broadcast-test_index.js
│
├── server-webtransport/      # Serwer WebTransport HTTP/3 (@fails-components/webtransport)
│   ├── echo-test_index.js    # Obsługuje streams I datagrams
│   ├── broadcast-test_index.js
│   └── mkcert.js             # Generator self-signed cert (node-forge)
│
├── client-simulator/         # Simulator klientów (ESM)
│   ├── config.js             # Konfiguracja przez zmienne środowiskowe
│   ├── utils.js              # Helpery: CSV writer, sleep, pLimit
│   ├── echo-test_client-simulator.js
│   ├── broadcast-test_client-simulator.js
│   └── protocols/
│       ├── sse.js
│       ├── websocket.js
│       ├── webrtc.js
│       ├── webtransport-streams.js
│       └── webtransport-datagrams.js
│
└── results/
    ├── echo-test/
    │   ├── rtt_<protocol>_<N>clients.csv
    │   ├── conn-time_<protocol>_<N>clients.csv
    │   └── throughput_<protocol>_<N>clients.csv
    └── broadcast-test/
        └── broadcast-latency_<protocol>_<N>clients.csv
```

---

## Szybki start

### 1. Wymagania

- **Node.js** ≥ 20.x  
- npm ≥ 9.x  
- (Opcjonalnie) **mkcert** — dla zaufanego certyfikatu WebTransport

### 2. Instalacja zależności

```bash
# Zainstaluj zależności dla wszystkich modułów jednym poleceniem:
npm run install:all

# Lub ręcznie każdy:
cd server-sse         && npm install && cd ..
cd server-websocket   && npm install && cd ..
cd server-webrtc      && npm install && cd ..
cd server-webtransport && npm install && cd ..
cd client-simulator   && npm install && cd ..
```

### 3. (Opcjonalnie) Certyfikat dla WebTransport

WebTransport wymaga HTTPS/QUIC. Serwer generuje self-signed cert automatycznie
(ważny 10 dni), ale można użyć `mkcert` dla certyfikatu zaufanego przez system:

```bash
# Instalacja mkcert: https://github.com/FiloSottile/mkcert
mkcert -install
mkcert localhost
# Skopiuj pliki do katalogu serwera:
cp localhost.pem localhost-key.pem server-webtransport/
```

### 4. Uruchomienie pełnego benchmarku

```bash
# Pełny suite (wszystkie protokoły, echo + broadcast, 100–1000 klientów, 3 powtórzenia):
node run-benchmark.js

# Szybki test (2 poziomy obciążenia, 1 powtórzenie, 30s):
npm run bench:quick

# Tylko echo test:
node run-benchmark.js --test echo

# Tylko broadcast test:
node run-benchmark.js --test broadcast

# Tylko jeden protokół:
node run-benchmark.js --protocol websocket --test both

# Własne obciążenia:
node run-benchmark.js --loads 100,500,1000 --runs 5 --duration 60

# Dry run (pokazuje co by zostało uruchomione):
node run-benchmark.js --dry-run
```

### 5. Ręczne uruchamianie (serwer + klient osobno)

```bash
# Terminal 1 — serwer WebSocket, echo test, 100 klientów:
cd server-websocket
node echo-test_index.js websocket 100

# Terminal 2 — klient simulator:
cd client-simulator
PROTOCOL=websocket SERVER_ID=websocket NUM_CLIENTS=100 node echo-test_client-simulator.js
```

---

## Porty serwerów

| Protokół | Port (echo/broadcast) | Dodatkowy port |
|----------|----------------------|----------------|
| SSE | 8080 | — |
| WebSocket | 8081 | — |
| WebRTC (signaling) | 8082 | — |
| WebTransport | 4433 (HTTP/3 QUIC) | 3000 (HTTPS fingerprint) |

---

## Zmienne środowiskowe klienta

| Zmienna | Domyślna | Opis |
|---------|----------|------|
| `PROTOCOL` | `websocket` | Protokół: `sse`, `websocket`, `webrtc`, `webtransport-streams`, `webtransport-datagrams` |
| `SERVER_ID` | `websocket` | Prefiks pliku CSV (np. `websocket`, `sse`) |
| `NUM_CLIENTS` | `100` | Liczba równoległych klientów |
| `TEST_DURATION_SECONDS` | `60` | Czas trwania testu (s) |
| `MESSAGE_INTERVAL_MS` | `3000` | Interwał sendera w broadcast test (ms) |
| `CLIENT_CONNECT_DELAY_MS` | `20` | Opóźnienie między podłączaniem kolejnych klientów (ms) |
| `WEBRTC_CONCURRENCY` | `30` | Maks. równoległych handshake'ów WebRTC |
| `OUTPUT_DIR` | `../results` | Katalog wyjściowy na pliki CSV |
| `SSE_BASE_URL` | `http://localhost:8080` | — |
| `WEBSOCKET_URL` | `ws://localhost:8081` | — |
| `WEBRTC_SIGNAL_URL` | `http://localhost:8082` | — |
| `WEBTRANSPORT_URL` | `https://localhost:4433` | — |
| `WEBTRANSPORT_HTTP_URL` | `https://localhost:3000` | — |

---

## Format plików CSV

### Echo Test — RTT
```csv
TIMESTAMP,CLIENT_ID,RTT_MS
2025-01-01T12:00:00.000,0,1.234
```

### Echo Test — Connection Time
```csv
TIMESTAMP,CLIENT_ID,CONNECTION_TIME_MS
2025-01-01T12:00:00.000,0,15.678
```

### Echo Test — Throughput (plik serwera)
```csv
TIMESTAMP,THROUGHPUT_MSGS_PER_SEC
2025-01-01T12:00:00.000,45231
```

### Broadcast Test — Broadcast Latency
```csv
TIMESTAMP,SENDER_ID,RECEIVER_ID,BROADCAST_LATENCY_MS
2025-01-01T12:00:00.000,0,42,2.456
```

---

## Uwagi dotyczące WebRTC

- WebRTC wymaga sygnalizacji (HTTP) do wymiany SDP i kandydatów ICE.
- Każdy klient wykonuje osobny handshake — dla dużych obciążeń (600–1000 klientów)
  czas połączenia jest znacznie dłuższy niż przy pozostałych protokołach.
- `WEBRTC_CONCURRENCY=30` ogranicza równoległe handshake'i aby uniknąć
  przeciążenia serwera sygnalizacyjnego.

## Uwagi dotyczące WebTransport

- Wymaga QUIC/HTTP3 → node.js musi mieć dostęp do UDP.
- Self-signed cert wymaga pobrania fingerprintu z `https://localhost:3000/fingerprint`.
- Datagramy są **unreliable** (mogą zginąć) — w środowisku localhost strat praktycznie nie ma.

---

## Metodologia (za artykułem Fernando & Engel, 2025)

- Każdy scenariusz uruchamiany **3-krotnie** → wynik = średnia
- Obciążenia: 100, 200, 400, 600, 800, 1000 klientów
- Każda faza: **60 sekund** transmisji danych
- Echo test: każdy klient wysyła następny ping natychmiast po odebraniu odpowiedzi
- Broadcast test: sender co 3 s, pozostali klienci mierzą latencję

---

## Analiza w Jupyter Notebook

Po zebraniu danych CSV uruchom notebook analizy (do przygotowania osobno):

```bash
jupyter notebook analysis/
```

Notebook będzie wczytywał CSV z `results/` i generował:
- Wykresy RTT vs. liczba klientów (per protokół)
- Wykresy throughput vs. liczba klientów
- Wykresy broadcast latency vs. liczba klientów
- Tabele statystyk (mean, median, std dev) przy 1000 klientach
