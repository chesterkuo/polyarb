# PolyArb

Live sports arbitrage bot for [Polymarket](https://polymarket.com). Monitors real-time esports and NBA game state, computes win probabilities, and trades when the market price diverges from the model's fair value.

## Architecture

```
Data Layer          Signal Layer        Decision Layer      Execution Layer
─────────────      ─────────────       ──────────────      ───────────────
Gamma Scanner ───► Win Prob Models ──► Arb Detector ────► CLOB Client
WS Listener        (esports, NBA)      Risk Guard          Position Manager
PandaScore                                                  Dry Run Simulator
BallDontLie
Pinnacle
Market Matcher
```

### Data Layer
- **GammaScanner** — polls Polymarket Gamma API for live esports and NBA markets
- **WsListener** — subscribes to Polymarket WebSocket for real-time token prices
- **PandaScoreClient** — fetches live match state and frame data for CS2, Dota 2, LoL
- **NbaLiveClient** — fetches live NBA game state from BallDontLie
- **PinnacleClient** — pulls sharp lines from Pinnacle for signal blending
- **MarketMatcher** — fuzzy-matches external matches to Polymarket markets using team name aliases

### Signal Layer
- **esports-wp** — computes win probability from in-game events (kills, objectives, gold leads)
- **nba-wp** — computes win probability from score, quarter, and time remaining
- Pinnacle lines are blended with model signals weighted by confidence

### Decision Layer
- **ArbDetector** — flags opportunities where model probability diverges from market price beyond `minEdge`
- **RiskGuard** — enforces position limits, daily loss caps, cooldowns, and max exposure

### Execution Layer
- **ClobClient** — submits Fill-or-Kill orders to Polymarket CLOB with HMAC authentication
- **PositionManager** — tracks open positions with trailing stop-loss and take-profit exits
- **DryRun** — simulates trades without touching the order book

### Monitoring
- **DbLogger** — logs trades and signals to SQLite
- **TelegramAlert** — sends trade notifications and alerts via Telegram bot
- **HealthServer** — HTTP health endpoint for uptime monitoring

## Setup

```bash
bun install
```

### Environment Variables

Create a `.env` file:

```env
POLYGON_PRIVATE_KEY=0x...
POLYMARKET_API_KEY=
POLYMARKET_SECRET=
POLYMARKET_PASSPHRASE=
POLYMARKET_PROXY_ADDRESS=

PANDASCORE_API_KEY=
BDL_API_KEY=
ODDS_API_KEY=

TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

DRY_RUN=true
```

## Usage

### Local (dry run by default)

```bash
bun run start
```

### PM2

```bash
# Dry run (default)
bun run pm2:start

# Live trading
bun run pm2:prod

# Manage
bun run pm2:logs
bun run pm2:stop
bun run pm2:restart
bun run pm2:status
```

### Docker

```bash
docker build -t polyarb .
docker run --env-file .env polyarb
```

## Configuration

Key parameters in `src/config.ts`:

| Parameter | Default | Description |
|---|---|---|
| `minEdge` | 8% | Minimum edge to trigger a trade |
| `kellyFraction` | 0.25 | Fraction of Kelly criterion for sizing |
| `maxPositionUsd` | $500 | Max size per position |
| `maxDailyLoss` | $300 | Daily loss circuit breaker |
| `maxOpenPositions` | 8 | Max concurrent positions |
| `maxTotalExposure` | $5,000 | Max total capital at risk |
| `cooldownMs` | 30s | Cooldown between trades on same market |
| `trailingStopPct` | 40% | Trailing stop-loss percentage |
| `takeProfitMultiplier` | 1.5x | Take profit relative to entry edge |
| `dryRun` | true | Simulate trades without execution |
