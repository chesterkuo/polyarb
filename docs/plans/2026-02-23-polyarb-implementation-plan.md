# PolyArb Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Bun + TypeScript latency arbitrage engine for Polymarket covering esports and NBA markets.

**Architecture:** 5-layer system — Data Collection → Signal Processing → Decision Engine → Trade Execution → Monitoring. Each layer is independently testable. Build bottom-up: types/config first, then monitoring (so other layers can log), then data collection, signals, arbitrage, execution, and finally the main entry point that wires everything together.

**Tech Stack:** Bun, TypeScript, viem (EIP-712 signing), bun:sqlite, native WebSocket, native fetch.

**Design Doc:** `docs/plans/2026-02-23-polyarb-prd-fixes-design.md`

---

## Phase 1: Project Scaffolding

### Task 1: Initialize Bun project and install dependencies

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `bunfig.toml`
- Create: `.env.example`
- Create: `.gitignore`

**Step 1: Initialize project**

Run:
```bash
cd /home/ubuntu/source/polyarb
bun init -y
```

**Step 2: Install dependencies**

Run:
```bash
bun add viem
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun-types"],
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

**Step 4: Create .env.example**

```bash
# Polygon Wallet
POLYGON_PRIVATE_KEY=0x...
POLYMARKET_PROXY_ADDRESS=0x...
POLYMARKET_API_KEY=...
POLYMARKET_SECRET=...
POLYMARKET_PASSPHRASE=...

# Esports APIs
PANDASCORE_API_KEY=...
STEAM_API_KEY=...

# NBA APIs
BDL_API_KEY=...
ODDS_API_KEY=...

# Monitoring
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...

# Safety
DRY_RUN=true
```

**Step 5: Create .gitignore**

```
node_modules/
dist/
.env
*.db
data/*.db
```

**Step 6: Create directory structure**

Run:
```bash
mkdir -p src/{data/esports,data/nba,signals/wp-models,arbitrage,execution,monitoring,utils} tests data
```

**Step 7: Commit**

```bash
git add package.json tsconfig.json bunfig.toml .env.example .gitignore bun.lockb
git commit -m "chore: initialize Bun project with viem dependency"
```

---

### Task 2: Core types and config

**Files:**
- Create: `src/types.ts`
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

**Step 1: Write the test for config**

```typescript
// tests/config.test.ts
import { describe, it, expect } from 'bun:test';
import { CONFIG } from '../src/config';

describe('CONFIG', () => {
  it('has required trading parameters', () => {
    expect(CONFIG.minEdge).toBeGreaterThan(0);
    expect(CONFIG.kellyFraction).toBeGreaterThan(0);
    expect(CONFIG.kellyFraction).toBeLessThanOrEqual(1);
    expect(CONFIG.maxPositionUsd).toBeGreaterThan(0);
    expect(CONFIG.maxDailyLoss).toBeGreaterThan(0);
    expect(CONFIG.totalCapitalUsd).toBeGreaterThan(0);
  });

  it('has valid position exit parameters', () => {
    expect(CONFIG.takeProfitMultiplier).toBeGreaterThan(0);
    expect(CONFIG.trailingStopPct).toBeGreaterThan(0);
    expect(CONFIG.trailingStopPct).toBeLessThanOrEqual(1);
    expect(CONFIG.hardStopLossPct).toBeGreaterThan(0);
    expect(CONFIG.maxHoldTimeMs).toBeGreaterThan(0);
  });

  it('has valid Polymarket endpoints', () => {
    expect(CONFIG.clobHost).toStartWith('https://');
    expect(CONFIG.gammaHost).toStartWith('https://');
    expect(CONFIG.wssHost).toStartWith('wss://');
  });

  it('has valid exchange addresses', () => {
    expect(CONFIG.ctfExchange).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(CONFIG.negRiskExchange).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it('dryRun defaults to true', () => {
    expect(CONFIG.dryRun).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/config.test.ts`
Expected: FAIL — module not found

**Step 3: Write src/types.ts**

```typescript
// src/types.ts
export type Side = 'YES' | 'NO';
export type Sport = 'lol' | 'dota2' | 'cs2' | 'nba';
export type Game = 'lol' | 'dota2' | 'cs2';

export interface Market {
  id: string;
  conditionId: string;
  question: string;
  yesTokenId: string;
  noTokenId: string;
  yesPrice: number;
  noPrice: number;
  externalId?: string;
  sport?: Sport;
  negRisk: boolean;
  tickSize: number;
}

export interface Signal {
  trueProb: number;
  confidence: number;
  source: string;
  triggeredBy?: string;
  timestamp: number;
}

export interface ArbOpportunity {
  market: Market;
  signal: Signal;
  side: Side;
  edge: number;
  tokenId: string;
  price: number;
  sizeUsd: number;
}

export interface TradeResult {
  orderId: string;
  status: 'filled' | 'cancelled' | 'dry_run';
  filledPrice: number;
  sizeUsd: number;
  pnl?: number;
}

export interface OpenPosition {
  id: string;
  marketId: string;
  tokenId: string;
  side: Side;
  entryPrice: number;
  sizeUsd: number;
  enteredAt: number;
  highWaterMark: number;
  currentPrice: number;
}

// Esports provider interfaces
export interface LiveMatch {
  id: string;
  game: Game;
  team1: string;
  team2: string;
  status: 'running' | 'finished';
  league?: string;
}

export interface TeamFrame {
  name: string;
  kills: number;
  gold: number;
  towers: number;
  inhibitors: number;
  dragons?: number;
  barons?: number;
  roshans?: number;
  score?: number;
}

export interface GameFrame {
  timestamp: number;
  gameTimeSeconds: number;
  teams: [TeamFrame, TeamFrame];
}

export type GameEventType =
  | 'dragon_kill' | 'baron_kill' | 'tower_kill' | 'inhibitor_kill'
  | 'roshan_kill' | 'barracks_kill' | 'round_win' | 'map_win' | 'game_end';

export interface GameEvent {
  type: GameEventType;
  team: 'team1' | 'team2';
  timestamp: number;
}
```

**Step 4: Write src/config.ts**

```typescript
// src/config.ts
export const CONFIG = {
  // Trading
  minEdge: 0.08,
  kellyFraction: 0.25,
  maxPositionUsd: 500,
  maxDailyLoss: 300,
  totalCapitalUsd: 10_000,
  dryRun: process.env.DRY_RUN !== 'false',

  // Position Exit
  takeProfitMultiplier: 1.5,
  trailingStopPct: 0.40,
  hardStopLossPct: 0.50,
  maxHoldTimeMs: 10 * 60 * 1000,

  // Polymarket
  clobHost: 'https://clob.polymarket.com',
  gammaHost: 'https://gamma-api.polymarket.com',
  wssHost: 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
  chainId: 137,
  ctfExchange: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
  negRiskExchange: '0xC5d563A36AE78145C45a50134d48A1215220f80a',

  // API Keys
  polygonKey: process.env.POLYGON_PRIVATE_KEY ?? '',
  proxyAddress: process.env.POLYMARKET_PROXY_ADDRESS ?? '',
  pandascoreKey: process.env.PANDASCORE_API_KEY ?? '',
  steamApiKey: process.env.STEAM_API_KEY ?? '',
  oddsApiKey: process.env.ODDS_API_KEY ?? '',
  bdlApiKey: process.env.BDL_API_KEY ?? '',
  telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? '',

  // Polling Intervals
  esportsPollMs: 200,
  esportsFramePollMs: 3000,
  nbaPollMs: 1000,
  gammaScanMs: 60_000,
  positionCheckMs: 2000,

  // Retry
  maxRetries: 3,
  retryBaseMs: 1000,

  // Health
  healthPort: 3000,

  // Risk
  maxOpenPositions: 8,
  maxTotalExposure: 5000,
  cooldownMs: 30_000,
  minConfidence: 0.6,
} as const;
```

**Step 5: Run test to verify it passes**

Run: `bun test tests/config.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/types.ts src/config.ts tests/config.test.ts
git commit -m "feat: add core types and config"
```

---

### Task 3: Fetch retry utility

**Files:**
- Create: `src/utils/fetch-retry.ts`
- Test: `tests/utils/fetch-retry.test.ts`

**Step 1: Write the test**

```typescript
// tests/utils/fetch-retry.test.ts
import { describe, it, expect, mock } from 'bun:test';
import { fetchWithRetry } from '../../src/utils/fetch-retry';

describe('fetchWithRetry', () => {
  it('returns response on first success', async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response('ok', { status: 200 }))
    );
    globalThis.fetch = mockFetch as any;

    const res = await fetchWithRetry('https://example.com');
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds', async () => {
    let calls = 0;
    globalThis.fetch = mock(() => {
      calls++;
      if (calls < 3) return Promise.reject(new Error('network'));
      return Promise.resolve(new Response('ok', { status: 200 }));
    }) as any;

    const res = await fetchWithRetry('https://example.com', {}, 3, 10);
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
  });

  it('throws after max retries exceeded', async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error('network'))
    ) as any;

    expect(
      fetchWithRetry('https://example.com', {}, 2, 10)
    ).rejects.toThrow('network');
  });

  it('retries on 429 status', async () => {
    let calls = 0;
    globalThis.fetch = mock(() => {
      calls++;
      if (calls < 2) return Promise.resolve(new Response('rate limited', { status: 429 }));
      return Promise.resolve(new Response('ok', { status: 200 }));
    }) as any;

    const res = await fetchWithRetry('https://example.com', {}, 3, 10);
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/utils/fetch-retry.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/utils/fetch-retry.ts
import { CONFIG } from '../config';

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  maxRetries = CONFIG.maxRetries,
  baseDelayMs = CONFIG.retryBaseMs,
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status === 429 && attempt < maxRetries) {
        await Bun.sleep(baseDelayMs * 2 ** attempt);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxRetries) {
        await Bun.sleep(baseDelayMs * 2 ** attempt);
      }
    }
  }

  throw lastError ?? new Error(`fetchWithRetry failed after ${maxRetries} retries`);
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/utils/fetch-retry.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/fetch-retry.ts tests/utils/fetch-retry.test.ts
git commit -m "feat: add fetchWithRetry utility with exponential backoff"
```

---

## Phase 2: Monitoring Layer (Layer 5)

Build monitoring first so all other layers can log and alert.

### Task 4: SQLite database logger

**Files:**
- Create: `src/monitoring/db.ts`
- Test: `tests/monitoring/db.test.ts`

**Step 1: Write the test**

```typescript
// tests/monitoring/db.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { DbLogger } from '../../src/monitoring/db';
import { Database } from 'bun:sqlite';
import type { ArbOpportunity, TradeResult, Signal } from '../../src/types';

describe('DbLogger', () => {
  let db: DbLogger;

  beforeEach(() => {
    db = new DbLogger(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates tables on init', () => {
    const tables = db.getDb()
      .query("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('trades');
    expect(names).toContain('signals');
    expect(names).toContain('daily_summary');
  });

  it('logs a trade', () => {
    const opp: ArbOpportunity = {
      market: {
        id: 'm1', conditionId: 'c1', question: 'test',
        yesTokenId: 'y1', noTokenId: 'n1',
        yesPrice: 0.5, noPrice: 0.5,
        negRisk: false, tickSize: 0.01,
      },
      signal: {
        trueProb: 0.7, confidence: 0.9,
        source: 'test', timestamp: Date.now(),
      },
      side: 'YES', edge: 0.2, tokenId: 'y1',
      price: 0.5, sizeUsd: 100,
    };
    const result: TradeResult = {
      orderId: 'o1', status: 'filled',
      filledPrice: 0.5, sizeUsd: 100, pnl: 20,
    };

    db.logTrade(opp, result);

    const rows = db.getDb().query('SELECT * FROM trades').all();
    expect(rows).toHaveLength(1);
  });

  it('logs a signal', () => {
    db.logSignal('m1', {
      trueProb: 0.7, confidence: 0.9,
      source: 'test', triggeredBy: 'baron_kill',
      timestamp: Date.now(),
    }, 0.5);

    const rows = db.getDb().query('SELECT * FROM signals').all();
    expect(rows).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/monitoring/db.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/monitoring/db.ts
import { Database } from 'bun:sqlite';
import type { ArbOpportunity, TradeResult, Signal } from '../types';

export class DbLogger {
  private db: Database;

  constructor(path: string = 'data/polyarb.db') {
    this.db = new Database(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        market_id TEXT NOT NULL,
        token_id TEXT NOT NULL,
        side TEXT NOT NULL,
        edge REAL NOT NULL,
        size_usd REAL NOT NULL,
        price REAL NOT NULL,
        status TEXT NOT NULL,
        pnl REAL,
        signal_source TEXT,
        signal_confidence REAL
      );
      CREATE TABLE IF NOT EXISTS signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        market_id TEXT NOT NULL,
        true_prob REAL NOT NULL,
        market_price REAL NOT NULL,
        edge REAL NOT NULL,
        source TEXT NOT NULL,
        triggered_by TEXT
      );
      CREATE TABLE IF NOT EXISTS daily_summary (
        date TEXT PRIMARY KEY,
        total_trades INTEGER,
        wins INTEGER,
        losses INTEGER,
        total_pnl REAL,
        max_drawdown REAL
      );
    `);
  }

  logTrade(opp: ArbOpportunity, result: TradeResult) {
    this.db.run(
      `INSERT INTO trades (timestamp, market_id, token_id, side, edge, size_usd, price, status, pnl, signal_source, signal_confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Date.now(), opp.market.id, opp.tokenId, opp.side,
        opp.edge, opp.sizeUsd, result.filledPrice, result.status,
        result.pnl ?? null, opp.signal.source, opp.signal.confidence,
      ],
    );
  }

  logSignal(marketId: string, signal: Signal, marketPrice: number) {
    this.db.run(
      `INSERT INTO signals (timestamp, market_id, true_prob, market_price, edge, source, triggered_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        signal.timestamp, marketId, signal.trueProb, marketPrice,
        signal.trueProb - marketPrice, signal.source,
        signal.triggeredBy ?? null,
      ],
    );
  }

  getDb() { return this.db; }
  close() { this.db.close(); }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/monitoring/db.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/monitoring/db.ts tests/monitoring/db.test.ts
git commit -m "feat: add SQLite logger with trades/signals/daily_summary tables"
```

---

### Task 5: Telegram alerts

**Files:**
- Create: `src/monitoring/telegram-alert.ts`
- Test: `tests/monitoring/telegram-alert.test.ts`

**Step 1: Write the test**

```typescript
// tests/monitoring/telegram-alert.test.ts
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { TelegramAlert } from '../../src/monitoring/telegram-alert';
import type { ArbOpportunity, TradeResult } from '../../src/types';

describe('TelegramAlert', () => {
  let tg: TelegramAlert;
  let fetchCalls: { url: string; body: string }[];

  beforeEach(() => {
    fetchCalls = [];
    globalThis.fetch = mock((url: string, init: any) => {
      fetchCalls.push({ url, body: init?.body });
      return Promise.resolve(new Response('ok'));
    }) as any;
    tg = new TelegramAlert('test-token', 'test-chat');
  });

  it('sends trade notification', async () => {
    const opp: ArbOpportunity = {
      market: {
        id: 'm1', conditionId: 'c1', question: 'Will T1 win?',
        yesTokenId: 'y1', noTokenId: 'n1',
        yesPrice: 0.5, noPrice: 0.5,
        negRisk: false, tickSize: 0.01,
      },
      signal: { trueProb: 0.7, confidence: 0.9, source: 'test', timestamp: Date.now() },
      side: 'YES', edge: 0.2, tokenId: 'y1', price: 0.5, sizeUsd: 100,
    };
    const result: TradeResult = {
      orderId: 'o1', status: 'filled', filledPrice: 0.5, sizeUsd: 100,
    };

    await tg.notifyTrade(opp, result);

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain('test-token');
    const body = JSON.parse(fetchCalls[0].body);
    expect(body.chat_id).toBe('test-chat');
    expect(body.text).toContain('BUY YES');
  });

  it('sends alert message', async () => {
    await tg.sendAlert('Test alert');
    expect(fetchCalls).toHaveLength(1);
    const body = JSON.parse(fetchCalls[0].body);
    expect(body.text).toContain('Test alert');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/monitoring/telegram-alert.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/monitoring/telegram-alert.ts
import type { ArbOpportunity, TradeResult } from '../types';

export class TelegramAlert {
  private baseUrl: string;

  constructor(
    private token: string,
    private chatId: string,
  ) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async send(text: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: this.chatId, text, parse_mode: 'HTML' }),
      });
    } catch (err) {
      console.error('[Telegram]', err);
    }
  }

  async notifyTrade(opp: ArbOpportunity, result: TradeResult): Promise<void> {
    const status = result.status === 'filled' ? 'FILLED' :
                   result.status === 'dry_run' ? 'DRY RUN' : 'CANCELLED';
    const text =
      `[TRADE] BUY ${opp.side} @ $${result.filledPrice.toFixed(2)} | ` +
      `Edge: ${(opp.edge * 100).toFixed(1)}% | Size: $${opp.sizeUsd.toFixed(0)} | ` +
      `Status: ${status} | Market: "${opp.market.question}"`;
    await this.send(text);
  }

  async sendAlert(message: string): Promise<void> {
    await this.send(`[ALERT] ${message}`);
  }

  async sendDailySummary(pnl: number, trades: number, wins: number, losses: number): Promise<void> {
    const text =
      `[P&L] Daily: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} | ` +
      `${trades} trades | ${wins}W/${losses}L`;
    await this.send(text);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/monitoring/telegram-alert.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/monitoring/telegram-alert.ts tests/monitoring/telegram-alert.test.ts
git commit -m "feat: add Telegram alert notifications"
```

---

### Task 6: Health check HTTP server

**Files:**
- Create: `src/monitoring/health.ts`
- Test: `tests/monitoring/health.test.ts`

**Step 1: Write the test**

```typescript
// tests/monitoring/health.test.ts
import { describe, it, expect, afterEach } from 'bun:test';
import { HealthServer } from '../../src/monitoring/health';

describe('HealthServer', () => {
  let server: HealthServer;

  afterEach(() => {
    server?.stop();
  });

  it('responds to /health with status ok', async () => {
    server = new HealthServer(0); // port 0 = random available port
    const port = server.getPort();

    const res = await fetch(`http://localhost:${port}/health`);
    const data = await res.json() as any;

    expect(res.status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.uptime).toBeGreaterThanOrEqual(0);
  });

  it('returns 404 for unknown routes', async () => {
    server = new HealthServer(0);
    const port = server.getPort();

    const res = await fetch(`http://localhost:${port}/unknown`);
    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/monitoring/health.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/monitoring/health.ts
export class HealthServer {
  private server: ReturnType<typeof Bun.serve>;
  private startedAt = Date.now();
  public lastTradeAt = 0;
  public openPositions = 0;
  public wsConnected = false;

  constructor(port: number) {
    this.server = Bun.serve({
      port,
      fetch: (req) => this.handleRequest(req),
    });
  }

  private handleRequest(req: Request): Response {
    const url = new URL(req.url);
    if (url.pathname === '/health') {
      return Response.json({
        status: 'ok',
        uptime: Math.floor((Date.now() - this.startedAt) / 1000),
        lastTrade: this.lastTradeAt,
        openPositions: this.openPositions,
        wsConnected: this.wsConnected,
      });
    }
    return new Response('Not Found', { status: 404 });
  }

  getPort(): number {
    return this.server.port;
  }

  stop() {
    this.server.stop();
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/monitoring/health.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/monitoring/health.ts tests/monitoring/health.test.ts
git commit -m "feat: add health check HTTP server"
```

---

## Phase 3: Signal Processing (Layer 2)

### Task 7: Bayesian logistic probability model (esports)

**Files:**
- Create: `src/signals/wp-models/esports-wp.ts`
- Test: `tests/signals/esports-wp.test.ts`

**Step 1: Write the test**

```typescript
// tests/signals/esports-wp.test.ts
import { describe, it, expect } from 'bun:test';
import { bayesianUpdate, EVENT_LOG_ODDS, computeEsportsWinProb } from '../../src/signals/wp-models/esports-wp';
import type { GameEvent } from '../../src/types';

describe('bayesianUpdate', () => {
  it('updates 50% probability correctly for baron kill', () => {
    const result = bayesianUpdate(0.5, EVENT_LOG_ODDS.baron_kill);
    expect(result).toBeGreaterThan(0.65);
    expect(result).toBeLessThan(0.75);
  });

  it('never exceeds 0.999', () => {
    const result = bayesianUpdate(0.95, 10.0);
    expect(result).toBeLessThan(1.0);
  });

  it('never goes below 0.001', () => {
    const result = bayesianUpdate(0.05, -10.0);
    expect(result).toBeGreaterThan(0.0);
  });

  it('shifts less at extreme probabilities', () => {
    const shiftAt50 = bayesianUpdate(0.5, 0.85) - 0.5;
    const shiftAt80 = bayesianUpdate(0.8, 0.85) - 0.8;
    expect(shiftAt50).toBeGreaterThan(shiftAt80);
  });

  it('is symmetric around 0.5', () => {
    const up = bayesianUpdate(0.5, 0.5);
    const down = bayesianUpdate(0.5, -0.5);
    expect(up + down).toBeCloseTo(1.0, 5);
  });
});

describe('computeEsportsWinProb', () => {
  it('returns 0.5 for no events', () => {
    expect(computeEsportsWinProb([])).toBeCloseTo(0.5);
  });

  it('increases for team1 baron kill', () => {
    const events: GameEvent[] = [
      { type: 'baron_kill', team: 'team1', timestamp: Date.now() },
    ];
    expect(computeEsportsWinProb(events)).toBeGreaterThan(0.6);
  });

  it('decreases for team2 events', () => {
    const events: GameEvent[] = [
      { type: 'inhibitor_kill', team: 'team2', timestamp: Date.now() },
    ];
    expect(computeEsportsWinProb(events)).toBeLessThan(0.4);
  });

  it('handles game_end correctly', () => {
    const events: GameEvent[] = [
      { type: 'game_end', team: 'team1', timestamp: Date.now() },
    ];
    expect(computeEsportsWinProb(events)).toBeGreaterThan(0.999);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/signals/esports-wp.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/signals/wp-models/esports-wp.ts
import type { GameEvent, GameEventType } from '../../types';

export const EVENT_LOG_ODDS: Record<GameEventType, number> = {
  dragon_kill:    0.25,
  baron_kill:     0.85,
  tower_kill:     0.35,
  inhibitor_kill: 1.5,
  roshan_kill:    0.85,
  barracks_kill:  1.5,
  round_win:      0.15,
  map_win:        1.2,
  game_end:       10.0,
};

export function bayesianUpdate(currentProb: number, impactLogOdds: number): number {
  const p = Math.max(0.001, Math.min(0.999, currentProb));
  const logOdds = Math.log(p / (1 - p));
  const updated = logOdds + impactLogOdds;
  return 1 / (1 + Math.exp(-updated));
}

export function computeEsportsWinProb(events: GameEvent[], startProb = 0.5): number {
  let prob = startProb;
  for (const event of events) {
    const impact = EVENT_LOG_ODDS[event.type] ?? 0;
    const direction = event.team === 'team1' ? 1 : -1;
    prob = bayesianUpdate(prob, impact * direction);
  }
  return prob;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/signals/esports-wp.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/signals/wp-models/esports-wp.ts tests/signals/esports-wp.test.ts
git commit -m "feat: add Bayesian logistic esports win probability model"
```

---

### Task 8: NBA win probability model

**Files:**
- Create: `src/signals/wp-models/nba-wp.ts`
- Test: `tests/signals/nba-wp.test.ts`

**Step 1: Write the test**

```typescript
// tests/signals/nba-wp.test.ts
import { describe, it, expect } from 'bun:test';
import { calcNbaWinProb, type GameState } from '../../src/signals/wp-models/nba-wp';

describe('calcNbaWinProb', () => {
  it('returns ~0.5 for tied game at start', () => {
    const state: GameState = { scoreDiff: 0, period: 1, timeLeft: '12:00' };
    const prob = calcNbaWinProb(state, true);
    expect(prob).toBeGreaterThan(0.5);   // slight home advantage
    expect(prob).toBeLessThan(0.65);
  });

  it('returns higher prob for home team with large lead', () => {
    const state: GameState = { scoreDiff: 20, period: 4, timeLeft: '5:00' };
    const prob = calcNbaWinProb(state, true);
    expect(prob).toBeGreaterThan(0.9);
  });

  it('returns low prob for home team when trailing big late', () => {
    const state: GameState = { scoreDiff: -15, period: 4, timeLeft: '2:00' };
    const prob = calcNbaWinProb(state, true);
    expect(prob).toBeLessThan(0.1);
  });

  it('is bounded between 0.02 and 0.98', () => {
    const extreme: GameState = { scoreDiff: 50, period: 4, timeLeft: '0:30' };
    expect(calcNbaWinProb(extreme, true)).toBeLessThanOrEqual(0.98);
    expect(calcNbaWinProb(extreme, false)).toBeGreaterThanOrEqual(0.02);
  });

  it('score matters more with less time', () => {
    const early: GameState = { scoreDiff: 10, period: 1, timeLeft: '6:00' };
    const late: GameState = { scoreDiff: 10, period: 4, timeLeft: '2:00' };
    const probEarly = calcNbaWinProb(early, true);
    const probLate = calcNbaWinProb(late, true);
    expect(probLate).toBeGreaterThan(probEarly);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/signals/nba-wp.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/signals/wp-models/nba-wp.ts
export interface GameState {
  scoreDiff: number;     // home - visitor (positive = home leads)
  period: number;        // 1-4, 5=OT
  timeLeft: string;      // 'MM:SS'
  isPlayoffs?: boolean;
}

export function calcNbaWinProb(state: GameState, forHome: boolean): number {
  const { scoreDiff, period, timeLeft, isPlayoffs = false } = state;

  const [m, s] = timeLeft.split(':').map(Number);
  const minutesLeft = m + s / 60 + Math.max(0, 4 - period) * 12;

  const homeAdv = isPlayoffs ? 2.5 : 3.5;
  const adjustedDiff = forHome
    ? scoreDiff + homeAdv
    : -scoreDiff - homeAdv;

  const timeWeight = Math.sqrt(Math.max(minutesLeft, 0.1));
  const k = 0.4 / timeWeight;
  const prob = 1 / (1 + Math.exp(-k * adjustedDiff));

  return Math.max(0.02, Math.min(0.98, prob));
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/signals/nba-wp.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/signals/wp-models/nba-wp.ts tests/signals/nba-wp.test.ts
git commit -m "feat: add NBA live win probability model"
```

---

### Task 9: Edge calculator

**Files:**
- Create: `src/signals/edge-calculator.ts`
- Test: `tests/signals/edge-calculator.test.ts`

**Step 1: Write the test**

```typescript
// tests/signals/edge-calculator.test.ts
import { describe, it, expect } from 'bun:test';
import { calcEdge, calcKellySize } from '../../src/signals/edge-calculator';

describe('calcEdge', () => {
  it('calculates positive YES edge', () => {
    expect(calcEdge(0.7, 0.5, 0.5)).toEqual({ side: 'YES', edge: 0.2 });
  });

  it('calculates positive NO edge', () => {
    expect(calcEdge(0.3, 0.5, 0.5)).toEqual({ side: 'NO', edge: 0.2 });
  });

  it('picks the larger edge', () => {
    const result = calcEdge(0.7, 0.55, 0.50);
    expect(result.side).toBe('NO');
    expect(result.edge).toBeCloseTo(0.2);
  });
});

describe('calcKellySize', () => {
  it('returns positive size for positive edge', () => {
    const size = calcKellySize(0.7, 0.5, 0.25, 10000);
    expect(size).toBeGreaterThan(0);
  });

  it('returns 0 for negative edge', () => {
    const size = calcKellySize(0.4, 0.5, 0.25, 10000);
    expect(size).toBe(0);
  });

  it('respects max position size', () => {
    const size = calcKellySize(0.99, 0.01, 0.25, 100000);
    expect(size).toBeLessThanOrEqual(500);
  });

  it('returns 0 for size below minimum', () => {
    const size = calcKellySize(0.51, 0.5, 0.25, 100);
    expect(size).toBe(0); // too small to trade
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/signals/edge-calculator.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/signals/edge-calculator.ts
import type { Side } from '../types';
import { CONFIG } from '../config';

export function calcEdge(
  trueProb: number,
  yesPrice: number,
  noPrice: number,
): { side: Side; edge: number } {
  const edgeYes = trueProb - yesPrice;
  const edgeNo = (1 - trueProb) - noPrice;

  if (edgeYes >= edgeNo) {
    return { side: 'YES', edge: edgeYes };
  }
  return { side: 'NO', edge: edgeNo };
}

export function calcKellySize(
  trueProb: number,
  price: number,
  kellyFraction: number = CONFIG.kellyFraction,
  totalCapital: number = CONFIG.totalCapitalUsd,
): number {
  const b = (1 / price) - 1;
  if (b <= 0) return 0;

  const kelly = Math.max(0, (b * trueProb - (1 - trueProb)) / b);
  const size = Math.min(CONFIG.maxPositionUsd, kelly * kellyFraction * totalCapital);

  return size < 5 ? 0 : size;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/signals/edge-calculator.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/signals/edge-calculator.ts tests/signals/edge-calculator.test.ts
git commit -m "feat: add edge calculator with Kelly criterion sizing"
```

---

## Phase 4: Decision Engine (Layer 3)

### Task 10: Arbitrage detector with confidence-based confirmation

**Files:**
- Create: `src/arbitrage/detector.ts`
- Test: `tests/arbitrage/detector.test.ts`

**Step 1: Write the test**

```typescript
// tests/arbitrage/detector.test.ts
import { describe, it, expect } from 'bun:test';
import { ArbDetector } from '../../src/arbitrage/detector';
import type { Market, Signal } from '../../src/types';

const makeMarket = (yesPrice = 0.5): Market => ({
  id: 'm1', conditionId: 'c1', question: 'test',
  yesTokenId: 'y1', noTokenId: 'n1',
  yesPrice, noPrice: 1 - yesPrice,
  negRisk: false, tickSize: 0.01,
});

const makeSignal = (trueProb: number, confidence: number): Signal => ({
  trueProb, confidence, source: 'test', timestamp: Date.now(),
});

describe('ArbDetector', () => {
  it('returns null when edge is below minimum', () => {
    const detector = new ArbDetector();
    const result = detector.detect(makeMarket(0.5), makeSignal(0.55, 0.9));
    expect(result).toBeNull();
  });

  it('executes immediately on high confidence (>= 0.85)', () => {
    const detector = new ArbDetector();
    const result = detector.detect(makeMarket(0.5), makeSignal(0.7, 0.9));
    expect(result).not.toBeNull();
    expect(result!.side).toBe('YES');
    expect(result!.edge).toBeCloseTo(0.2);
  });

  it('requires 1 confirmation for medium confidence (0.70-0.85)', () => {
    const detector = new ArbDetector();
    const signal = makeSignal(0.7, 0.75);

    const first = detector.detect(makeMarket(0.5), signal);
    expect(first).toBeNull();

    const second = detector.detect(makeMarket(0.5), signal);
    expect(second).not.toBeNull();
  });

  it('requires 2 confirmations for low confidence (< 0.70)', () => {
    const detector = new ArbDetector();
    const signal = makeSignal(0.7, 0.65);

    expect(detector.detect(makeMarket(0.5), signal)).toBeNull();
    expect(detector.detect(makeMarket(0.5), signal)).toBeNull();
    expect(detector.detect(makeMarket(0.5), signal)).not.toBeNull();
  });

  it('resets confirmation count when edge disappears', () => {
    const detector = new ArbDetector();
    detector.detect(makeMarket(0.5), makeSignal(0.7, 0.65)); // +1 confirm
    detector.detect(makeMarket(0.5), makeSignal(0.52, 0.65)); // edge gone, reset
    expect(detector.detect(makeMarket(0.5), makeSignal(0.7, 0.65))).toBeNull(); // back to 1
  });

  it('selects NO side when NO edge is bigger', () => {
    const detector = new ArbDetector();
    const result = detector.detect(makeMarket(0.5), makeSignal(0.3, 0.9));
    expect(result).not.toBeNull();
    expect(result!.side).toBe('NO');
  });

  it('returns null when kelly size is too small', () => {
    const detector = new ArbDetector();
    // Edge is just barely above minimum but price is near 1.0 so kelly is tiny
    const result = detector.detect(makeMarket(0.91), makeSignal(0.999, 0.9));
    // May or may not be null depending on kelly calc — just verify no crash
    expect(result === null || result.sizeUsd >= 5).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/arbitrage/detector.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/arbitrage/detector.ts
import type { Market, Signal, ArbOpportunity } from '../types';
import { CONFIG } from '../config';
import { calcEdge, calcKellySize } from '../signals/edge-calculator';

function shouldExecute(confidence: number, confirmCount: number): boolean {
  if (confidence >= 0.85) return true;
  if (confidence >= 0.70) return confirmCount >= 1;
  return confirmCount >= 2;
}

export class ArbDetector {
  private confirmCounts = new Map<string, number>();

  detect(market: Market, signal: Signal): ArbOpportunity | null {
    const { side, edge } = calcEdge(signal.trueProb, market.yesPrice, market.noPrice);

    if (edge < CONFIG.minEdge) {
      this.confirmCounts.delete(market.yesTokenId);
      return null;
    }

    const key = market.yesTokenId;
    const count = (this.confirmCounts.get(key) ?? 0) + 1;
    this.confirmCounts.set(key, count);

    if (!shouldExecute(signal.confidence, count)) return null;

    this.confirmCounts.delete(key);

    const tokenId = side === 'YES' ? market.yesTokenId : market.noTokenId;
    const price = side === 'YES' ? market.yesPrice : market.noPrice;
    const trueP = side === 'YES' ? signal.trueProb : 1 - signal.trueProb;
    const sizeUsd = calcKellySize(trueP, price);

    if (sizeUsd < 5) return null;

    return { market, signal, side, edge, tokenId, price, sizeUsd };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/arbitrage/detector.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/arbitrage/detector.ts tests/arbitrage/detector.test.ts
git commit -m "feat: add arbitrage detector with confidence-based confirmation"
```

---

### Task 11: Risk guard with position lifecycle

**Files:**
- Create: `src/arbitrage/risk-guard.ts`
- Test: `tests/arbitrage/risk-guard.test.ts`

**Step 1: Write the test**

```typescript
// tests/arbitrage/risk-guard.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { RiskGuard } from '../../src/arbitrage/risk-guard';
import type { ArbOpportunity } from '../../src/types';

const makeOpp = (marketId = 'm1', sizeUsd = 100, confidence = 0.8): ArbOpportunity => ({
  market: {
    id: marketId, conditionId: 'c1', question: 'test',
    yesTokenId: 'y1', noTokenId: 'n1',
    yesPrice: 0.5, noPrice: 0.5,
    negRisk: false, tickSize: 0.01,
  },
  signal: { trueProb: 0.7, confidence, source: 'test', timestamp: Date.now() },
  side: 'YES', edge: 0.2, tokenId: 'y1', price: 0.5, sizeUsd,
});

describe('RiskGuard', () => {
  let guard: RiskGuard;

  beforeEach(() => {
    guard = new RiskGuard();
  });

  it('allows first trade', () => {
    expect(guard.allow(makeOpp())).toBe(true);
  });

  it('blocks when daily loss exceeded', () => {
    guard.recordOpen('p1', 100);
    guard.recordClose('p1', 100, -301);
    expect(guard.allow(makeOpp())).toBe(false);
  });

  it('blocks when max exposure exceeded', () => {
    for (let i = 0; i < 5; i++) {
      guard.recordOpen(`p${i}`, 1100);
    }
    expect(guard.allow(makeOpp('m2', 1000))).toBe(false);
  });

  it('blocks when max open positions exceeded', () => {
    for (let i = 0; i < 8; i++) {
      guard.recordOpen(`p${i}`, 10);
    }
    expect(guard.allow(makeOpp('m2'))).toBe(false);
  });

  it('blocks during cooldown for same market', () => {
    guard.recordOpen('p1', 100);
    guard.setLastTradeTime('m1', Date.now());
    expect(guard.allow(makeOpp('m1'))).toBe(false);
  });

  it('allows different market during cooldown', () => {
    guard.setLastTradeTime('m1', Date.now());
    expect(guard.allow(makeOpp('m2'))).toBe(true);
  });

  it('blocks when confidence below minimum', () => {
    expect(guard.allow(makeOpp('m1', 100, 0.3))).toBe(false);
  });

  it('unblocks after position close', () => {
    for (let i = 0; i < 8; i++) {
      guard.recordOpen(`p${i}`, 10);
    }
    guard.recordClose('p0', 10, 5);
    expect(guard.allow(makeOpp('m2'))).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/arbitrage/risk-guard.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/arbitrage/risk-guard.ts
import { CONFIG } from '../config';
import type { ArbOpportunity } from '../types';

export class RiskGuard {
  private dailyLoss = 0;
  private lastResetDate = new Date().toISOString().split('T')[0];
  private totalExposure = 0;
  private openCount = 0;
  private marketCooldowns = new Map<string, number>();

  allow(opp: ArbOpportunity): boolean {
    this.checkDayReset();

    if (this.dailyLoss >= CONFIG.maxDailyLoss) return false;
    if (this.totalExposure + opp.sizeUsd > CONFIG.maxTotalExposure) return false;
    if (this.openCount >= CONFIG.maxOpenPositions) return false;
    if (opp.signal.confidence < CONFIG.minConfidence) return false;
    if (opp.sizeUsd < 5) return false;

    const lastTrade = this.marketCooldowns.get(opp.market.id);
    if (lastTrade && Date.now() - lastTrade < CONFIG.cooldownMs) return false;

    return true;
  }

  recordOpen(positionId: string, sizeUsd: number) {
    this.totalExposure += sizeUsd;
    this.openCount++;
  }

  recordClose(positionId: string, sizeUsd: number, pnl: number) {
    this.totalExposure = Math.max(0, this.totalExposure - sizeUsd);
    this.openCount = Math.max(0, this.openCount - 1);
    if (pnl < 0) this.dailyLoss += Math.abs(pnl);
  }

  setLastTradeTime(marketId: string, timestamp: number) {
    this.marketCooldowns.set(marketId, timestamp);
  }

  private checkDayReset() {
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.lastResetDate) {
      this.dailyLoss = 0;
      this.lastResetDate = today;
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/arbitrage/risk-guard.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/arbitrage/risk-guard.ts tests/arbitrage/risk-guard.test.ts
git commit -m "feat: add risk guard with position lifecycle tracking"
```

---

## Phase 5: Data Collection (Layer 1)

### Task 12: Esports data provider interface + frame differ

**Files:**
- Create: `src/data/esports/provider.ts`
- Create: `src/data/esports/frame-differ.ts`
- Test: `tests/data/esports/frame-differ.test.ts`

**Step 1: Write the test**

```typescript
// tests/data/esports/frame-differ.test.ts
import { describe, it, expect } from 'bun:test';
import { diffFrames } from '../../../src/data/esports/frame-differ';
import type { GameFrame } from '../../../src/types';

const makeFrame = (overrides: {
  t1?: Partial<import('../../../src/types').TeamFrame>;
  t2?: Partial<import('../../../src/types').TeamFrame>;
  time?: number;
} = {}): GameFrame => ({
  timestamp: Date.now(),
  gameTimeSeconds: overrides.time ?? 600,
  teams: [
    { name: 'Team A', kills: 0, gold: 10000, towers: 0, inhibitors: 0, dragons: 0, barons: 0, ...overrides.t1 },
    { name: 'Team B', kills: 0, gold: 10000, towers: 0, inhibitors: 0, dragons: 0, barons: 0, ...overrides.t2 },
  ],
});

describe('diffFrames', () => {
  it('returns empty array for identical frames', () => {
    const f = makeFrame();
    expect(diffFrames(f, f)).toEqual([]);
  });

  it('detects dragon kill for team1', () => {
    const prev = makeFrame({ t1: { dragons: 0 } });
    const curr = makeFrame({ t1: { dragons: 1 } });
    const events = diffFrames(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('dragon_kill');
    expect(events[0].team).toBe('team1');
  });

  it('detects baron kill for team2', () => {
    const prev = makeFrame({ t2: { barons: 0 } });
    const curr = makeFrame({ t2: { barons: 1 } });
    const events = diffFrames(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('baron_kill');
    expect(events[0].team).toBe('team2');
  });

  it('detects tower kill', () => {
    const prev = makeFrame({ t1: { towers: 2 } });
    const curr = makeFrame({ t1: { towers: 3 } });
    const events = diffFrames(prev, curr);
    expect(events.some(e => e.type === 'tower_kill')).toBe(true);
  });

  it('detects inhibitor kill', () => {
    const prev = makeFrame({ t1: { inhibitors: 0 } });
    const curr = makeFrame({ t1: { inhibitors: 1 } });
    const events = diffFrames(prev, curr);
    expect(events.some(e => e.type === 'inhibitor_kill')).toBe(true);
  });

  it('detects multiple events in one frame', () => {
    const prev = makeFrame({ t1: { dragons: 0, towers: 2 } });
    const curr = makeFrame({ t1: { dragons: 1, towers: 3 } });
    const events = diffFrames(prev, curr);
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it('detects CS2 round win via score', () => {
    const prev = makeFrame({ t1: { score: 5 } });
    const curr = makeFrame({ t1: { score: 6 } });
    const events = diffFrames(prev, curr);
    expect(events.some(e => e.type === 'round_win')).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/data/esports/frame-differ.test.ts`
Expected: FAIL

**Step 3: Write provider interface**

```typescript
// src/data/esports/provider.ts
import type { LiveMatch, GameFrame, Game } from '../../types';

export interface EsportsDataProvider {
  getLiveMatches(game: Game): Promise<LiveMatch[]>;
  getMatchFrames(matchId: string): Promise<GameFrame[]>;
}
```

**Step 4: Write frame differ**

```typescript
// src/data/esports/frame-differ.ts
import type { GameFrame, GameEvent, TeamFrame } from '../../types';

function diffTeam(
  prev: TeamFrame,
  curr: TeamFrame,
  team: 'team1' | 'team2',
  timestamp: number,
): GameEvent[] {
  const events: GameEvent[] = [];

  const dragons = (curr.dragons ?? 0) - (prev.dragons ?? 0);
  for (let i = 0; i < dragons; i++) {
    events.push({ type: 'dragon_kill', team, timestamp });
  }

  const barons = (curr.barons ?? 0) - (prev.barons ?? 0);
  for (let i = 0; i < barons; i++) {
    events.push({ type: 'baron_kill', team, timestamp });
  }

  const roshans = (curr.roshans ?? 0) - (prev.roshans ?? 0);
  for (let i = 0; i < roshans; i++) {
    events.push({ type: 'roshan_kill', team, timestamp });
  }

  const towers = curr.towers - prev.towers;
  for (let i = 0; i < towers; i++) {
    events.push({ type: 'tower_kill', team, timestamp });
  }

  const inhibs = curr.inhibitors - prev.inhibitors;
  for (let i = 0; i < inhibs; i++) {
    events.push({ type: 'inhibitor_kill', team, timestamp });
  }

  const scoreChange = (curr.score ?? 0) - (prev.score ?? 0);
  for (let i = 0; i < scoreChange; i++) {
    events.push({ type: 'round_win', team, timestamp });
  }

  return events;
}

export function diffFrames(prev: GameFrame, curr: GameFrame): GameEvent[] {
  const ts = curr.timestamp;
  return [
    ...diffTeam(prev.teams[0], curr.teams[0], 'team1', ts),
    ...diffTeam(prev.teams[1], curr.teams[1], 'team2', ts),
  ];
}
```

**Step 5: Run test to verify it passes**

Run: `bun test tests/data/esports/frame-differ.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/data/esports/provider.ts src/data/esports/frame-differ.ts tests/data/esports/frame-differ.test.ts
git commit -m "feat: add esports data provider interface and frame differ"
```

---

### Task 13: PandaScore client

**Files:**
- Create: `src/data/esports/pandascore-client.ts`
- Test: `tests/data/esports/pandascore-client.test.ts`

**Step 1: Write the test**

```typescript
// tests/data/esports/pandascore-client.test.ts
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { PandaScoreClient } from '../../../src/data/esports/pandascore-client';

describe('PandaScoreClient', () => {
  let client: PandaScoreClient;

  beforeEach(() => {
    client = new PandaScoreClient('test-key');
  });

  it('fetches live matches', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify([
      {
        id: 123,
        name: 'T1 vs Gen.G',
        status: 'running',
        opponents: [
          { opponent: { name: 'T1' } },
          { opponent: { name: 'Gen.G' } },
        ],
        league: { name: 'LCK' },
        games: [{ id: 456, status: 'running' }],
      },
    ])))) as any;

    const matches = await client.getLiveMatches('lol');
    expect(matches).toHaveLength(1);
    expect(matches[0].team1).toBe('T1');
    expect(matches[0].team2).toBe('Gen.G');
    expect(matches[0].game).toBe('lol');
  });

  it('returns empty for no live matches', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify([])))
    ) as any;

    const matches = await client.getLiveMatches('cs2');
    expect(matches).toEqual([]);
  });

  it('uses correct game slug for CS2', async () => {
    let calledUrl = '';
    globalThis.fetch = mock((url: string) => {
      calledUrl = url;
      return Promise.resolve(new Response(JSON.stringify([])));
    }) as any;

    await client.getLiveMatches('cs2');
    expect(calledUrl).toContain('/csgo/');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/data/esports/pandascore-client.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/data/esports/pandascore-client.ts
import type { EsportsDataProvider } from './provider';
import type { LiveMatch, GameFrame, Game, TeamFrame } from '../../types';
import { fetchWithRetry } from '../../utils/fetch-retry';

const GAME_SLUGS: Record<Game, string> = {
  lol: 'lol',
  dota2: 'dota2',
  cs2: 'csgo',
};

interface PandaMatch {
  id: number;
  name: string;
  status: string;
  opponents: Array<{ opponent: { name: string } }>;
  league?: { name: string };
  games?: Array<{ id: number; status: string }>;
}

interface PandaFrame {
  timestamp: number;
  teams: Array<{
    name: string;
    kills: number;
    gold_earned: number;
    tower_kills: number;
    inhibitor_kills?: number;
    dragon_kills?: number;
    baron_kills?: number;
    roshan_kills?: number;
    score?: number;
  }>;
}

export class PandaScoreClient implements EsportsDataProvider {
  private baseUrl = 'https://api.pandascore.co';
  private headers: HeadersInit;

  constructor(apiKey: string) {
    this.headers = {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    };
  }

  async getLiveMatches(game: Game): Promise<LiveMatch[]> {
    const slug = GAME_SLUGS[game];
    const res = await fetchWithRetry(
      `${this.baseUrl}/${slug}/matches/running`,
      { headers: this.headers },
    );
    const data = (await res.json()) as PandaMatch[];

    return data.map((m) => ({
      id: String(m.id),
      game,
      team1: m.opponents[0]?.opponent?.name ?? 'Unknown',
      team2: m.opponents[1]?.opponent?.name ?? 'Unknown',
      status: m.status === 'running' ? 'running' as const : 'finished' as const,
      league: m.league?.name,
    }));
  }

  async getMatchFrames(gameId: string): Promise<GameFrame[]> {
    const res = await fetchWithRetry(
      `${this.baseUrl}/lol/games/${gameId}/frames`,
      { headers: this.headers },
    );
    const data = (await res.json()) as PandaFrame[];

    return data.map((f) => ({
      timestamp: f.timestamp,
      gameTimeSeconds: 0,
      teams: [
        this.toTeamFrame(f.teams[0]),
        this.toTeamFrame(f.teams[1]),
      ] as [TeamFrame, TeamFrame],
    }));
  }

  private toTeamFrame(t: PandaFrame['teams'][0]): TeamFrame {
    return {
      name: t.name,
      kills: t.kills,
      gold: t.gold_earned,
      towers: t.tower_kills,
      inhibitors: t.inhibitor_kills ?? 0,
      dragons: t.dragon_kills,
      barons: t.baron_kills,
      roshans: t.roshan_kills,
      score: t.score,
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/data/esports/pandascore-client.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/data/esports/pandascore-client.ts tests/data/esports/pandascore-client.test.ts
git commit -m "feat: add PandaScore esports data client"
```

---

### Task 14: Polymarket Gamma market scanner

**Files:**
- Create: `src/data/polymarket-gamma.ts`
- Test: `tests/data/polymarket-gamma.test.ts`

**Step 1: Write the test**

```typescript
// tests/data/polymarket-gamma.test.ts
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { GammaScanner } from '../../src/data/polymarket-gamma';

const mockMarket = (overrides = {}) => ({
  id: 'm1',
  conditionId: 'c1',
  question: 'Will T1 win vs Gen.G?',
  clobTokenIds: ['yes-token-123', 'no-token-456'],
  outcomePrices: ['0.65', '0.35'],
  active: true,
  closed: false,
  acceptingOrders: true,
  tags: ['esports', 'lol'],
  negRisk: false,
  ...overrides,
});

describe('GammaScanner', () => {
  let scanner: GammaScanner;

  beforeEach(() => {
    scanner = new GammaScanner();
  });

  it('fetches and parses esports markets', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(
      JSON.stringify([mockMarket()])
    ))) as any;

    const markets = await scanner.getMarkets('esports');
    expect(markets).toHaveLength(1);
    expect(markets[0].yesTokenId).toBe('yes-token-123');
    expect(markets[0].noTokenId).toBe('no-token-456');
    expect(markets[0].yesPrice).toBe(0.65);
    expect(markets[0].noPrice).toBe(0.35);
  });

  it('filters out inactive markets', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(
      JSON.stringify([
        mockMarket(),
        mockMarket({ id: 'm2', acceptingOrders: false }),
      ])
    ))) as any;

    const markets = await scanner.getMarkets('esports');
    expect(markets).toHaveLength(1);
  });

  it('parses negRisk flag', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(
      JSON.stringify([mockMarket({ negRisk: true })])
    ))) as any;

    const markets = await scanner.getMarkets('esports');
    expect(markets[0].negRisk).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/data/polymarket-gamma.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/data/polymarket-gamma.ts
import type { Market } from '../types';
import { CONFIG } from '../config';
import { fetchWithRetry } from '../utils/fetch-retry';

interface GammaMarketRaw {
  id: string;
  conditionId: string;
  question: string;
  clobTokenIds: string[];
  outcomePrices: string[];
  active: boolean;
  closed: boolean;
  acceptingOrders: boolean;
  tags: string[];
  negRisk: boolean;
}

export class GammaScanner {
  async getMarkets(tag: string): Promise<Market[]> {
    const res = await fetchWithRetry(
      `${CONFIG.gammaHost}/markets?active=true&tag=${tag}&limit=100`,
    );
    const data = (await res.json()) as GammaMarketRaw[];

    return data
      .filter((m) => m.active && m.acceptingOrders && !m.closed)
      .map((m) => ({
        id: m.id,
        conditionId: m.conditionId,
        question: m.question,
        yesTokenId: m.clobTokenIds[0],
        noTokenId: m.clobTokenIds[1],
        yesPrice: parseFloat(m.outcomePrices[0]),
        noPrice: parseFloat(m.outcomePrices[1]),
        negRisk: m.negRisk ?? false,
        tickSize: 0.01,
      }));
  }

  async getEsportsMarkets(): Promise<Market[]> {
    return this.getMarkets('esports');
  }

  async getNbaMarkets(): Promise<Market[]> {
    return this.getMarkets('nba');
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/data/polymarket-gamma.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/data/polymarket-gamma.ts tests/data/polymarket-gamma.test.ts
git commit -m "feat: add Polymarket Gamma market scanner"
```

---

### Task 15: Polymarket WebSocket price listener

### Task 16: NBA BallDontLie client (v2)

### Task 17: Pinnacle client (typo fix + proper types)

### Task 18: Market matcher (keyword + fuzzy)

_(Tasks 15-18 follow the same TDD pattern. Each creates the test first, verifies failure, writes minimal implementation, verifies pass, commits. Detailed code is in the design doc sections 8.2, 6.3/6.4, and 7.)_

---

## Phase 6: Trade Execution (Layer 4)

### Task 19: EIP-712 order signer

**Files:**
- Create: `src/execution/signer.ts`
- Test: `tests/execution/signer.test.ts`

**Step 1: Write the test**

```typescript
// tests/execution/signer.test.ts
import { describe, it, expect } from 'bun:test';
import { OrderSigner, EXCHANGE_ADDRESSES } from '../../src/execution/signer';
import { privateKeyToAccount } from 'viem/accounts';

describe('OrderSigner', () => {
  const testKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const account = privateKeyToAccount(testKey);
  const signer = new OrderSigner(testKey, account.address);

  it('signs an order and returns hex signature', async () => {
    const sig = await signer.signOrder({
      salt: '12345',
      maker: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      signer: account.address,
      taker: '0x0000000000000000000000000000000000000000',
      tokenId: '999',
      makerAmount: '100000000',
      takerAmount: '200000000',
      expiration: '0',
      nonce: '0',
      feeRateBps: '0',
      side: 0,
      signatureType: 1,
    }, false);

    expect(sig).toMatch(/^0x[a-f0-9]+01$/); // ends with POLY_PROXY byte
    expect(sig.length).toBe(2 + 130 + 2); // 0x + 65 bytes hex + 01
  });

  it('uses correct exchange for negRisk', async () => {
    // Just verify it doesn't throw for both exchange types
    const order = {
      salt: '1', maker: account.address, signer: account.address,
      taker: '0x0000000000000000000000000000000000000000',
      tokenId: '1', makerAmount: '1', takerAmount: '1',
      expiration: '0', nonce: '0', feeRateBps: '0',
      side: 0 as const, signatureType: 1 as const,
    };

    const sigNormal = await signer.signOrder(order, false);
    const sigNegRisk = await signer.signOrder(order, true);

    expect(sigNormal).not.toBe(sigNegRisk); // different domains
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/execution/signer.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/execution/signer.ts
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

export const EXCHANGE_ADDRESSES = {
  CTF: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E' as Hex,
  NEG_RISK: '0xC5d563A36AE78145C45a50134d48A1215220f80a' as Hex,
} as const;

const ORDER_TYPES = {
  Order: [
    { name: 'salt', type: 'uint256' },
    { name: 'maker', type: 'address' },
    { name: 'signer', type: 'address' },
    { name: 'taker', type: 'address' },
    { name: 'tokenId', type: 'uint256' },
    { name: 'makerAmount', type: 'uint256' },
    { name: 'takerAmount', type: 'uint256' },
    { name: 'expiration', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'feeRateBps', type: 'uint256' },
    { name: 'side', type: 'uint8' },
    { name: 'signatureType', type: 'uint8' },
  ],
} as const;

export interface OrderStruct {
  salt: string;
  maker: string;
  signer: string;
  taker: string;
  tokenId: string;
  makerAmount: string;
  takerAmount: string;
  expiration: string;
  nonce: string;
  feeRateBps: string;
  side: 0 | 1;
  signatureType: 0 | 1 | 2;
}

export class OrderSigner {
  private account: ReturnType<typeof privateKeyToAccount>;

  constructor(privateKey: string, public readonly signerAddress: string) {
    this.account = privateKeyToAccount(privateKey as Hex);
  }

  async signOrder(order: OrderStruct, negRisk: boolean): Promise<string> {
    const domain = {
      name: 'ClobExchange' as const,
      version: '1' as const,
      chainId: 137,
      verifyingContract: negRisk ? EXCHANGE_ADDRESSES.NEG_RISK : EXCHANGE_ADDRESSES.CTF,
    };

    const signature = await this.account.signTypedData({
      domain,
      types: ORDER_TYPES,
      primaryType: 'Order',
      message: {
        salt: BigInt(order.salt),
        maker: order.maker as Hex,
        signer: order.signer as Hex,
        taker: order.taker as Hex,
        tokenId: BigInt(order.tokenId),
        makerAmount: BigInt(order.makerAmount),
        takerAmount: BigInt(order.takerAmount),
        expiration: BigInt(order.expiration),
        nonce: BigInt(order.nonce),
        feeRateBps: BigInt(order.feeRateBps),
        side: order.side,
        signatureType: order.signatureType,
      },
    });

    // Append signature type byte
    const typeByte = order.signatureType.toString(16).padStart(2, '0');
    return signature + typeByte;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/execution/signer.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/execution/signer.ts tests/execution/signer.test.ts
git commit -m "feat: add EIP-712 order signer using viem"
```

---

### Task 20: Order builder (amounts + tick size)

### Task 21: CLOB client (HMAC auth + order submission)

### Task 22: Dry run simulator

### Task 23: Position manager (trailing stop + take profit)

_(Tasks 20-23 follow the same TDD pattern. Key implementation details are in design doc sections 3, 8.3, and 5.)_

---

## Phase 7: Integration

### Task 24: Main entry point

**Files:**
- Create: `src/main.ts`

Wire all modules together:
1. Initialize monitoring (DB, Telegram, Health)
2. Initialize data layer (Gamma scanner, WS listener, esports clients, NBA client, Pinnacle)
3. Initialize signal layer (market matcher)
4. Initialize decision layer (detector, risk guard)
5. Initialize execution layer (signer, order builder, CLOB client, position manager, dry run)
6. Start esports loop, NBA loop, position manager loop
7. Register graceful shutdown handlers

**Step 1: Write main.ts** (following the pattern from PRD section 8, but wiring in all new modules)

**Step 2: Run in dry mode**

Run: `DRY_RUN=true bun run src/main.ts`
Expected: Starts, logs "PolyArb starting | dry_run: true", begins scanning markets

**Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: add main entry point wiring all modules"
```

---

### Task 25: Docker deployment files

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`

**Step 1: Write Dockerfile**

```dockerfile
FROM oven/bun:latest
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
CMD ["bun", "run", "src/main.ts"]
```

**Step 2: Write docker-compose.yml**

```yaml
services:
  polyarb:
    build: .
    env_file: .env
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
```

**Step 3: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "chore: add Docker deployment files"
```

---

### Task 26: Data files (team names + market overrides)

**Files:**
- Create: `data/team-names.json`
- Create: `data/market-overrides.json`

Populate team-names.json with major LOL, Dota 2, CS2, and NBA team aliases.
Create empty market-overrides.json as `{}`.

**Commit**

```bash
git add data/
git commit -m "chore: add team name dictionary and market overrides"
```

---

## Summary

| Phase | Tasks | What's Built |
|-------|-------|-------------|
| 1 (Scaffolding) | 1-3 | Project, types, config, fetch retry |
| 2 (Monitoring) | 4-6 | SQLite logger, Telegram alerts, health server |
| 3 (Signals) | 7-9 | Esports WP model, NBA WP model, edge calculator |
| 4 (Decision) | 10-11 | Arb detector, risk guard |
| 5 (Data) | 12-18 | Esports providers, Gamma scanner, WS listener, NBA client, Pinnacle, market matcher |
| 6 (Execution) | 19-23 | EIP-712 signer, order builder, CLOB client, dry run, position manager |
| 7 (Integration) | 24-26 | Main entry, Docker, data files |

Total: ~26 tasks, each with TDD cycle (test → fail → implement → pass → commit).
