# PolyArb PRD Fixes — Design Document

| Field | Value |
|-------|-------|
| Date | 2026-02-23 |
| Status | Approved |
| PRD Version | v1.0 → v1.1 |

---

## 1. Esports Data Source — Multi-Source Architecture

### Problem
The PRD uses `https://127.0.0.1:2999/liveclientdata` (Riot local game client API), which only works when running the game locally. This cannot monitor professional tournaments.

### Solution
Replace with a multi-source architecture using game-native APIs as primary and PandaScore as fallback/CS2 primary.

| Game | Primary Source | Latency | Fallback |
|------|---------------|---------|----------|
| League of Legends | Riot Esports Live Events API | ~2-8s | PandaScore (~5-15s) |
| Dota 2 | Steam Web API (`GetLiveLeagueGames`) | ~2-5s | PandaScore (~5-15s) |
| CS2 | PandaScore (only viable single-API option) | ~5-30s | None |

### Interface Abstraction

All providers implement a common interface so they can be swapped without changing downstream code (e.g., to Grid.gg/Bayes in the future):

```typescript
interface EsportsDataProvider {
  getLiveMatches(game: 'lol' | 'dota2' | 'cs2'): Promise<LiveMatch[]>;
  getMatchFrames(matchId: string): Promise<GameFrame[]>;
}

interface LiveMatch {
  id: string;
  game: 'lol' | 'dota2' | 'cs2';
  team1: string;
  team2: string;
  status: 'running' | 'finished';
  league?: string;
}

interface GameFrame {
  timestamp: number;          // Unix ms
  gameTimeSeconds: number;
  teams: [TeamFrame, TeamFrame];
}

interface TeamFrame {
  name: string;
  kills: number;
  gold: number;
  towers: number;
  inhibitors: number;
  dragons?: number;
  barons?: number;
  roshans?: number;
  score?: number;             // CS2 round score
}
```

### PandaScore Specifics
- Base URL: `https://api.pandascore.co`
- Auth: `Authorization: Bearer <token>`
- Game slugs: `lol`, `dota2`, `csgo` (for CS2)
- Data model: polling-only, frame snapshots every ~10s
- Rate limits: Free tier insufficient (1000 req/hr). Need Professional tier (~$99-249/mo) for 50k req/hr.
- Polling strategy: `/matches/running` every 30s to discover matches; `/games/{id}/frames` every 3-5s only for matches with active Polymarket markets.

### Frame Diffing
Events are detected by comparing consecutive frames. New module `frame-differ.ts` compares previous vs current frame and emits events:

```typescript
interface GameEvent {
  type: 'dragon_kill' | 'baron_kill' | 'tower_kill' | 'inhibitor_kill' |
        'roshan_kill' | 'barracks_kill' | 'round_win' | 'map_win' | 'game_end';
  team: 'team1' | 'team2';
  timestamp: number;
}
```

### New Files
- `src/data/esports/provider.ts` — `EsportsDataProvider` interface
- `src/data/esports/pandascore-client.ts` — PandaScore implementation (replaces `riot-client.ts`)
- `src/data/esports/riot-esports.ts` — Riot Esports API for LOL
- `src/data/esports/steam-client.ts` — Steam Web API for Dota 2 (renamed from `dota-client.ts`)
- `src/data/esports/frame-differ.ts` — Detect events from frame diffs

### Env Vars
- Replace `RIOT_API_KEY` with `PANDASCORE_API_KEY`
- Keep `STEAM_API_KEY` for Dota 2
- Add `RIOT_ESPORTS_API_KEY` if needed (Riot Esports API may require separate key)

---

## 2. Probability Model — Bayesian Logistic Update

### Problem
The additive probability model (`currentWinProb + probDelta`) is mathematically broken. At 80% + Baron(+20%) = 100%, which is incorrect. Probabilities can overshoot or undershoot.

### Solution
Update probabilities in **log-odds space**. Event impacts are defined as log-odds deltas, which naturally prevent overshoot:

```typescript
function bayesianUpdate(currentProb: number, impactLogOdds: number): number {
  // Clamp input to avoid log(0) or log(infinity)
  const p = Math.max(0.001, Math.min(0.999, currentProb));
  const logOdds = Math.log(p / (1 - p));
  const updated = logOdds + impactLogOdds;
  return 1 / (1 + Math.exp(-updated));
}
```

### Event Impact Table (Log-Odds)

| Event | Log-odds | ~Shift at 50% | ~Shift at 80% |
|-------|----------|--------------|--------------|
| Dragon kill | +0.25 | ~6% | ~3% |
| Baron / Roshan kill | +0.85 | ~19% | ~9% |
| Tower destroyed | +0.35 | ~8% | ~4% |
| Inhibitor / Barracks destroyed | +1.5 | ~28% | ~12% |
| Second inhibitor | +2.5 | ~40% | ~15% |
| Mega creeps | +3.5 | ~48% | ~18% |
| CS2 round win | +0.15 | ~4% | ~2% |
| CS2 pistol round (1, 13) | +0.45 | ~11% | ~5% |
| CS2 map win | +1.2 | ~23% | ~10% |
| Game end / match end | +10.0 | →99.99% | →99.99% |

### File Changed
- `src/signals/wp-models/esports-wp.ts` — complete rewrite with `bayesianUpdate()` and log-odds impact table

---

## 3. CLOB Order Signing — TypeScript Port

### Problem
The PRD's `clob-client.ts` only does HMAC auth. It doesn't construct valid EIP-712 signed orders required by the CTF Exchange.

### Solution
Port the py-clob-client signing flow to TypeScript using `viem`.

### EIP-712 Domain

```typescript
const EXCHANGE_ADDRESSES = {
  CTF:     '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
  NEG_RISK: '0xC5d563A36AE78145C45a50134d48A1215220f80a',
} as const;

// Domain — verifyingContract depends on market's negRisk flag
const domain = {
  name: 'ClobExchange',
  version: '1',
  chainId: 137,
  verifyingContract: market.negRisk ? EXCHANGE_ADDRESSES.NEG_RISK : EXCHANGE_ADDRESSES.CTF,
};
```

### Order Struct (12 fields)

```typescript
const OrderType = {
  Order: [
    { name: 'salt',          type: 'uint256' },
    { name: 'maker',         type: 'address' },   // proxy address
    { name: 'signer',        type: 'address' },   // EOA address
    { name: 'taker',         type: 'address' },   // 0x000...000
    { name: 'tokenId',       type: 'uint256' },   // conditional token ID
    { name: 'makerAmount',   type: 'uint256' },   // USDC raw (6 decimals)
    { name: 'takerAmount',   type: 'uint256' },   // CT raw (6 decimals)
    { name: 'expiration',    type: 'uint256' },   // 0 = no expiry
    { name: 'nonce',         type: 'uint256' },   // 0
    { name: 'feeRateBps',    type: 'uint256' },   // 0
    { name: 'side',          type: 'uint8' },     // 0=BUY, 1=SELL
    { name: 'signatureType', type: 'uint8' },     // 1=POLY_PROXY
  ],
};
```

### Amount Calculation

```
BUY at price p, spending size USDC:
  makerAmount = floor(size * 1e6)       // what you pay
  takerAmount = floor(size / p * 1e6)   // what you receive

Price must be rounded to market tick size (query GET /tick-size?token_id={id}).
Amounts are integer strings.
```

### Signing Flow
1. Build Order struct
2. Sign with viem `signTypedData()`
3. Append signature type byte: `signature + "01"` (POLY_PROXY)
4. Submit via `POST /order` with HMAC L2 auth headers

### Critical Gotchas
- `side` is uint8 (0/1) in EIP-712 but string ("BUY"/"SELL") in REST API
- `maker` = proxy address, `signer` = EOA — do NOT confuse
- Domain name is `"ClobExchange"` not `"CTFExchange"`
- Check `negRisk` flag from Gamma API to pick correct exchange address

### New Files
- `src/execution/order-builder.ts` — Build Order struct, amount calculation, tick size
- `src/execution/signer.ts` — EIP-712 signing with viem, signature type byte
- `src/execution/clob-client.ts` — Rewritten: HMAC auth, REST API, API key derivation

### Dependencies
- `viem` — EIP-712 signing
- `node:crypto` — HMAC-SHA256

---

## 4. RiskGuard — Position Lifecycle Tracking

### Problem
`openCount`, `totalExp` never decrement. `dailyLoss` never resets. After 8 trades the bot stops permanently.

### Solution
Track full position lifecycle:

```typescript
interface OpenPosition {
  id: string;                // unique position ID
  marketId: string;
  tokenId: string;
  side: Side;
  entryPrice: number;
  sizeUsd: number;
  enteredAt: number;         // Unix ms
  highWaterMark: number;     // Best unrealized P&L (for trailing stop)
  currentPrice: number;      // Updated from WS
}
```

### Fixes
- **`openCount`**: Incremented on `recordOpen()`, decremented on `recordClose()`
- **`totalExp`**: Same — tracks net exposure
- **`dailyLoss`**: Store `lastResetDate`. On each `allow()` call, compare to current UTC date. Reset if new day.
- **Cooldown**: Per-market cooldown via `Map<marketId, number>` instead of single global `lastTradeAt`

### File Changed
- `src/arbitrage/risk-guard.ts` — complete rewrite with position lifecycle

---

## 5. Position Exit — Trailing Stop + Take Profit

### Problem
The PRD only has entry logic. No mechanism to close positions.

### Solution
New module `src/execution/position-manager.ts` that monitors open positions and exits when triggers hit.

### Exit Triggers

| Trigger | Condition | Priority |
|---------|-----------|----------|
| Take profit | Unrealized P&L > entry edge x 1.5 | Normal |
| Trailing stop | P&L drops 40% from high-water mark | Normal |
| Hard stop-loss | Unrealized loss > 50% of position size | High |
| Max hold time | Position open > 10 minutes | Normal |
| Market convergence | Market price within 1% of true probability | Normal |

### Implementation
- Runs its own loop every 2 seconds
- Reads latest prices from WS listener
- For each open position, checks exit triggers in priority order
- Executes SELL order via `clob-client.submitFokOrder()` (or dry-run)
- Calls `riskGuard.recordClose()` on exit

### New File
- `src/execution/position-manager.ts`

---

## 6. Confidence-Based Confirmation Skip

### Problem
Static `confirmCount: 2` with 500ms polling = 1s minimum delay, conflicting with <500ms target.

### Solution
Adaptive confirmation based on signal confidence:

```typescript
function shouldExecute(signal: Signal, confirmCount: number): boolean {
  if (signal.confidence >= 0.85) return true;            // Immediate
  if (signal.confidence >= 0.70) return confirmCount >= 1; // 1 confirm
  return confirmCount >= 2;                                // 2 confirms
}
```

Detector loop polls at **200ms** (was 500ms). For PandaScore-sourced signals, the external API is still polled at 3-5s, but the detector reacts to WS price changes at 200ms.

### File Changed
- `src/arbitrage/detector.ts` — replace static confirmCount with `shouldExecute()`

---

## 7. Market Matching — Keyword + Fuzzy Match

### Problem
No spec for mapping Polymarket questions to external game IDs. This is the hardest data engineering problem.

### Solution
New module `src/data/market-matcher.ts`:

### Algorithm
1. Fetch active markets from Gamma API with `?tag=esports` and `?tag=nba`
2. Parse `question` text to extract:
   - Team names (using normalized dictionary from `data/team-names.json`)
   - Date (today / tomorrow)
   - Game type (LOL, Dota 2, CS2, NBA)
3. For each parsed market, search external API's live matches for:
   - Both team names present (fuzzy match with Levenshtein distance < 3)
   - Same date
   - Same game type
4. Cache successful mappings: `Map<polymarketConditionId, externalGameId>`
5. Support manual override via `data/market-overrides.json` for edge cases

### Team Name Dictionary (`data/team-names.json`)
```json
{
  "lol": {
    "T1": ["T1", "SKT", "SK Telecom"],
    "Gen.G": ["Gen.G", "GenG", "Gen G"],
    "...": "..."
  },
  "nba": {
    "LAL": ["Lakers", "Los Angeles Lakers", "LA Lakers"],
    "BOS": ["Celtics", "Boston Celtics", "Boston"],
    "...": "..."
  }
}
```

### New Files
- `src/data/market-matcher.ts`
- `data/team-names.json`
- `data/market-overrides.json`

---

## 8. Missing Module Specifications

### 8.1 `src/data/polymarket-gamma.ts` — Market Scanner

- Poll `GET /markets?active=true&tag=esports&limit=100` every 60s
- Poll `GET /markets?active=true&tag=nba&limit=100` every 60s
- Parse: `clobTokenIds`, `outcomePrices`, `question`, `tags`, `negRisk`, `acceptingOrders`
- Filter: `active === true && acceptingOrders === true`
- No authentication required
- Feed matched markets into arbitrage loop via event emitter

### 8.2 `src/data/polymarket-ws.ts` — WebSocket Price Listener

- Connect to `wss://ws-subscriptions-clob.polymarket.com/ws/market`
- Subscribe: `{ type: "subscribe", channel: "market", assets_id: tokenId }`
- Parse `price_change` / `last_trade_price` events
- 30s ping keepalive
- Auto-reconnect with exponential backoff (1s, 2s, 4s, 8s, max 30s)
- Maintain `Map<tokenId, { price: number, updatedAt: number }>`
- Stale detection: if a token's price hasn't updated in >60s, re-subscribe
- No authentication required for price channels

### 8.3 `src/execution/dry-run.ts` — Simulation

```typescript
export class DryRun {
  static simulate(opp: ArbOpportunity): TradeResult {
    console.log(`[DRY RUN] Would ${opp.side} ${opp.tokenId} @ $${opp.price} for $${opp.sizeUsd}`);
    return {
      orderId: `dry_${Date.now()}`,
      status: 'dry_run',
      filledPrice: opp.price,
      sizeUsd: opp.sizeUsd,
      pnl: 0,
    };
  }
}
```

### 8.4 `src/monitoring/db.ts` — SQLite Logger

Schema:

```sql
CREATE TABLE trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  market_id TEXT NOT NULL,
  token_id TEXT NOT NULL,
  side TEXT NOT NULL,          -- 'YES' | 'NO'
  edge REAL NOT NULL,
  size_usd REAL NOT NULL,
  price REAL NOT NULL,
  status TEXT NOT NULL,        -- 'filled' | 'cancelled' | 'dry_run'
  pnl REAL,
  signal_source TEXT,
  signal_confidence REAL
);

CREATE TABLE signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  market_id TEXT NOT NULL,
  true_prob REAL NOT NULL,
  market_price REAL NOT NULL,
  edge REAL NOT NULL,
  source TEXT NOT NULL,
  triggered_by TEXT
);

CREATE TABLE daily_summary (
  date TEXT PRIMARY KEY,       -- 'YYYY-MM-DD'
  total_trades INTEGER,
  wins INTEGER,
  losses INTEGER,
  total_pnl REAL,
  max_drawdown REAL
);
```

Uses `bun:sqlite` for zero-dependency SQLite access.

### 8.5 `src/monitoring/telegram-alert.ts` — Notifications

Events that trigger alerts:
- Trade executed (filled or dry_run)
- Daily P&L summary (at UTC midnight)
- Error / circuit breaker triggered
- Daily loss limit hit
- WebSocket disconnection lasting > 60s

Message format:
```
[TRADE] BUY YES @ $0.55 | Edge: 12.3% | Size: $250 | Market: "Will T1 win?"
[P&L] Daily: +$47.20 | 8 trades | 6W/2L | Streak: +3
[ALERT] Daily loss limit hit ($300). Trading paused until tomorrow.
```

Uses Telegram Bot API: `POST https://api.telegram.org/bot{token}/sendMessage`

### 8.6 `src/monitoring/health.ts` — Health Check

HTTP server on port 3000:
- `GET /health` → `{ status: "ok", uptime: 3600, lastTrade: 1708700000, openPositions: 3, wsConnected: true }`

Uses `Bun.serve()`.

---

## 9. Minor Fixes

| # | Issue | Fix |
|---|-------|-----|
| 11 | Typo `PinnaclecClient` | Rename to `PinnacleClient` |
| 12 | BallDontLie v1 API | Update to v2: `https://api.balldontlie.io/v2` |
| 13 | The Odds API rate limits | Document: free tier = 500 req/mo. Need paid plan for live polling. |
| 14 | No retry logic | Add `fetchWithRetry()` utility: exponential backoff 1s/2s/4s, max 3 retries |
| 15 | `as any[]` casting | Define proper response interfaces, add runtime validation with type guards |
| 16 | No graceful shutdown | `process.on('SIGINT'/'SIGTERM')`: close WS, flush SQLite WAL, log final state |
| 17 | No health endpoint | New `src/monitoring/health.ts` (see 8.6 above) |
| 18 | Single Riot client for all markets | Each market gets its own provider instance with scoped game state |

---

## 10. Updated Types

```typescript
// src/types.ts — additions

export interface Market {
  id: string;                // Gamma market ID
  conditionId: string;       // On-chain condition ID
  question: string;
  yesTokenId: string;
  noTokenId: string;
  yesPrice: number;
  noPrice: number;
  externalId?: string;       // Matched external game ID
  sport?: 'lol' | 'dota2' | 'cs2' | 'nba';
  negRisk: boolean;          // NEW: determines exchange address
  tickSize: number;          // NEW: price tick size
}

export type Side = 'YES' | 'NO';

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

// NEW
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
```

---

## 11. Updated Config

```typescript
// src/config.ts — additions/changes

export const CONFIG = {
  // Trading
  minEdge: 0.08,
  kellyFraction: 0.25,
  maxPositionUsd: 500,
  maxDailyLoss: 300,
  totalCapitalUsd: 10_000,        // NEW: configurable (was hardcoded)
  dryRun: true,

  // Confirmation — REMOVED static confirmCount
  // Now handled by confidence-based logic in detector.ts

  // Position Exit — NEW
  takeProfitMultiplier: 1.5,      // Exit when P&L > edge * 1.5
  trailingStopPct: 0.40,          // Exit when P&L drops 40% from HWM
  hardStopLossPct: 0.50,          // Exit when loss > 50% of position
  maxHoldTimeMs: 10 * 60 * 1000,  // 10 minutes

  // Polymarket
  clobHost: 'https://clob.polymarket.com',
  gammaHost: 'https://gamma-api.polymarket.com',
  wssHost: 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
  chainId: 137,
  ctfExchange: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
  negRiskExchange: '0xC5d563A36AE78145C45a50134d48A1215220f80a',

  // API Keys
  polygonKey: process.env.POLYGON_PRIVATE_KEY!,
  proxyAddress: process.env.POLYMARKET_PROXY_ADDRESS!,
  pandascoreKey: process.env.PANDASCORE_API_KEY!,     // NEW
  steamApiKey: process.env.STEAM_API_KEY!,
  oddsApiKey: process.env.ODDS_API_KEY!,
  bdlApiKey: process.env.BDL_API_KEY!,
  telegramToken: process.env.TELEGRAM_BOT_TOKEN!,
  telegramChatId: process.env.TELEGRAM_CHAT_ID!,

  // Polling Intervals
  esportsPollMs: 200,             // Detector loop
  esportsFramePollMs: 3000,       // PandaScore frame polling
  nbaPollMs: 1000,
  gammaScanMs: 60_000,            // Market discovery
  positionCheckMs: 2000,          // Position manager loop

  // Retry
  maxRetries: 3,
  retryBaseMs: 1000,

  // Health
  healthPort: 3000,
} as const;
```

---

## 12. Updated Directory Structure

```
polyarb/
├── src/
│   ├── main.ts                      # Entry: start all modules + graceful shutdown
│   ├── config.ts                    # Updated with new params
│   ├── types.ts                     # Updated with new interfaces
│   ├── utils/
│   │   └── fetch-retry.ts           # fetchWithRetry() utility
│   │
│   ├── data/                        # Layer 1: Data Collection
│   │   ├── polymarket-gamma.ts      # Market scanner
│   │   ├── polymarket-ws.ts         # WS price listener + auto-reconnect
│   │   ├── market-matcher.ts        # Fuzzy market matching
│   │   ├── esports/
│   │   │   ├── provider.ts          # EsportsDataProvider interface
│   │   │   ├── pandascore-client.ts # PandaScore (CS2 primary, LOL/Dota fallback)
│   │   │   ├── riot-esports.ts      # Riot Esports API (LOL primary)
│   │   │   ├── steam-client.ts      # Steam Web API (Dota 2 primary)
│   │   │   └── frame-differ.ts      # Detect events from frame diffs
│   │   ├── nba/
│   │   │   ├── balldontlie.ts       # v2 API
│   │   │   └── espn-client.ts
│   │   └── pinnacle-client.ts       # Typo fixed
│   │
│   ├── signals/                     # Layer 2: Signal Processing
│   │   ├── normalizer.ts
│   │   ├── wp-models/
│   │   │   ├── nba-wp.ts
│   │   │   └── esports-wp.ts       # Bayesian logistic model
│   │   └── edge-calculator.ts
│   │
│   ├── arbitrage/                   # Layer 3: Decision Engine
│   │   ├── detector.ts             # Confidence-based confirmation
│   │   ├── validator.ts
│   │   └── risk-guard.ts           # Position lifecycle tracking
│   │
│   ├── execution/                   # Layer 4: Trade Execution
│   │   ├── clob-client.ts          # HMAC auth + REST API
│   │   ├── order-builder.ts        # EIP-712 Order struct + amounts
│   │   ├── signer.ts               # viem EIP-712 signing
│   │   ├── position-manager.ts     # Trailing stop / take profit
│   │   └── dry-run.ts              # Simulation mode
│   │
│   └── monitoring/                  # Layer 5: Monitoring
│       ├── db.ts                   # SQLite with schema
│       ├── pnl-tracker.ts
│       ├── telegram-alert.ts       # Notifications
│       └── health.ts               # HTTP health check
│
├── data/
│   ├── team-names.json             # Normalized team name dictionary
│   └── market-overrides.json       # Manual market-to-game mappings
├── tests/
├── .env.example                    # Updated with new vars
├── Dockerfile
├── docker-compose.yml
├── bunfig.toml
└── package.json
```

---

## 13. Dependencies

```json
{
  "dependencies": {
    "viem": "^2.x"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.x"
  }
}
```

Minimal — `viem` for EIP-712, everything else is Bun-native (`bun:sqlite`, `Bun.serve`, `Bun.sleep`, native WebSocket, native fetch).

---

## 14. Updated Env Vars

```bash
# .env.example

# Polygon Wallet
POLYGON_PRIVATE_KEY=0x...
POLYMARKET_PROXY_ADDRESS=0x...
POLYMARKET_API_KEY=...
POLYMARKET_SECRET=...
POLYMARKET_PASSPHRASE=...

# Esports APIs
PANDASCORE_API_KEY=...           # NEW (replaces RIOT_API_KEY)
STEAM_API_KEY=...
RIOT_ESPORTS_API_KEY=...         # NEW (optional, for Riot Esports)

# NBA APIs
BDL_API_KEY=...
ODDS_API_KEY=...

# Monitoring
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...

# Safety
DRY_RUN=true
```
