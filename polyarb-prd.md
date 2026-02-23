# PolyArb — Polymarket 時差套利機器人
## Product Requirements Document v1.0

| 欄位 | 內容 |
|------|------|
| 產品名稱 | PolyArb — Latency Arbitrage Engine |
| 版本 | v1.0 |
| 日期 | 2026-02-23 |
| 技術棧 | Bun + TypeScript |
| 策略模組 | Module A：電競時差套利（Esports Parser）+ Module B：NBA 即時勝率套利（Live WP Arb） |
| 負責人 | Chester / Plusblocks Technology |
| 狀態 | PRD 草稿 |

---

## 1. 產品概覽

PolyArb 是一套用 **Bun + TypeScript** 撰寫的全自動化高頻套利引擎，專門針對 Polymarket 預測市場中「真實賽況已改變、但市場價格尚未更新」的短暫時間差窗口進行交易。

核心策略**不依賴預測比賽結果**，而是利用資訊不對稱：從比賽官方 API 或外部尖銳博彩公司取得真實機率訊號，在 Polymarket 訂單簿反應前搶先完成 FOK 市價單下單。

> 💡 **核心洞察**：Polymarket 的 WebSocket 市場價格更新約落後真實世界 2–10 秒，這個窗口就是套利機會所在。

### 1.1 兩大策略模組

| 模組 | 說明 |
|------|------|
| **Module A：電競 Esports Parser** | 直接接 LOL（Riot API）/ Dota 2 / CS2 官方即時遊戲 API，比 Twitch 串流早 15–40 秒偵測關鍵事件（龍、Baron、高地、比賽結束），在 Polymarket 電競市場搶先下注 |
| **Module B：NBA Live WP Arb** | 整合 BallDontLie / ESPN API 的即時比分，搭配 Live Win Probability 模型估算當前真實勝率，與 Pinnacle 尖銳賠率交叉確認後，於 Polymarket NBA 市場執行套利 |

---

## 2. 問題陳述

### 2.1 市場機制造就套利窗口

Polymarket 的中央限價訂單簿（CLOB）依賴使用者手動更新報價，在重大賽事節點時，市場流動性提供者往往無法即時反應真實機率變化，形成系統性的定價滯後。

| 訊號來源 | 延遲 | 相對 Polymarket 的優勢窗口 |
|---------|------|--------------------------|
| 球場 / 電競官方 API | ~0–1 秒 | **2–10 秒** |
| Pinnacle 尖銳賠率 | ~2–5 秒 | 1–7 秒 |
| ESPN / BallDontLie API | ~3–8 秒 | 0–5 秒 |
| Polymarket WebSocket | ~100ms（基準） | — |
| 一般觀眾（Twitch） | 15–40 秒 | 機器人優勢巨大 |

### 2.2 真實案例佐證

- **swisstony wallet**：透過球場直連 API 將 $5 翻到 **$370 萬**（Reality Arbitrage）
- **電競 Esports Parser**：2025 年底帶來超過 **$20 萬**利潤（LOL/Dota 2）
- **Gambot**：Pinnacle 賠率 vs Polymarket 跨平台套利，2024–2025 年賺超過 **$400 萬**
- **BTC 15 分鐘時差機器人**：$313 → $41.4 萬（98% 勝率）

---

## 3. 目標與成功指標

### 3.1 核心目標

- 建立一套可穩定運行 24/7 的時差套利引擎，涵蓋電競與 NBA 兩大市場
- 偵測到套利機會後在 **< 500ms** 內完成下單（API 呼叫 + 簽名 + 提交）
- 確保每筆交易的 Expected Value (EV) > **2.5%**（覆蓋 Polymarket 2% 手續費）
- 系統支援乾跑模式（dry run）、模擬損益追蹤，確保安全上線

### 3.2 KPI 指標

| 指標 | 目標值 |
|------|--------|
| 訊號偵測到下單的端到端延遲 | < 500ms |
| 每日掃描市場數量 | > 50 個活躍市場 |
| 套利訊號確認準確率（減少假陽性） | > 90% |
| 單筆最低 EV 門檻 | > 2.5%（覆蓋手續費） |
| 系統可用率（Uptime） | > 99.5% |
| 測試期 dry run 週數 | 至少 2 週後才上真實資金 |

---

## 4. 系統架構

### 4.1 整體資料流

```
【Layer 1 資料採集】
  官方賽事 API ──────────────┐
  Pinnacle Odds Client ──────┤──► 【Layer 2 訊號處理】
  Polymarket WS Listener ────┘       Signal Normalizer
                                      Win Probability Model
                                      Edge Calculator
                                            │
                                            ▼
                                  【Layer 3 決策引擎】
                                    Arbitrage Detector
                                    Kelly Sizing Engine
                                    Risk Guard
                                            │
                                            ▼
                                  【Layer 4 執行層】
                                    CLOB Order Builder
                                    EIP-712 Signer
                                    FOK Order Submitter
                                            │
                                            ▼
                                  【Layer 5 監控 / 日誌】
                                    SQLite Logger
                                    P&L Tracker
                                    Telegram Alert
```

### 4.2 技術棧選擇

| 層次 | 元件 | 技術 |
|------|------|------|
| Layer 1 資料採集 | Esports API Client、NBA Live Client、Pinnacle Client、Polymarket WS | Bun WebSocket、Bun fetch（原生） |
| Layer 2 訊號處理 | Signal Normalizer、WP Models、Edge Calculator | TypeScript pure functions、Bun Workers |
| Layer 3 決策引擎 | Arbitrage Detector、Kelly Sizing、Risk Guard | State machine、Atomic flags |
| Layer 4 執行層 | CLOB Order Builder、EIP-712 Signer、FOK Submitter | REST API、Bun fetch + retry |
| Layer 5 監控 | P&L Tracker、Telegram Alert、SQLite Logger | Bun SQLite |

### 4.3 專案目錄結構

```
polyarb/
├── src/
│   ├── main.ts                   # 入口：啟動所有模組
│   ├── config.ts                 # 環境變數 & 全域設定
│   ├── types.ts                  # 共用 TypeScript 型別定義
│   │
│   ├── data/                     # Layer 1：資料採集
│   │   ├── polymarket-ws.ts      # Polymarket WebSocket 訂閱
│   │   ├── polymarket-gamma.ts   # Gamma API 市場掃描
│   │   ├── esports/
│   │   │   ├── riot-client.ts    # Riot Games API（LOL）
│   │   │   ├── dota-client.ts    # OpenDota API（Dota 2）
│   │   │   └── cs2-client.ts     # CS2 比賽 API
│   │   ├── nba/
│   │   │   ├── balldontlie.ts    # BallDontLie NBA 即時比分
│   │   │   └── espn-client.ts    # ESPN 非官方 API
│   │   └── pinnacle-client.ts    # Pinnacle 尖銳賠率
│   │
│   ├── signals/                  # Layer 2：訊號處理
│   │   ├── normalizer.ts         # 統一機率格式 [0,1]
│   │   ├── wp-models/
│   │   │   ├── nba-wp.ts         # NBA Live Win Probability
│   │   │   └── esports-wp.ts     # 電競賽況機率估算
│   │   └── edge-calculator.ts    # EV & Kelly 計算
│   │
│   ├── arbitrage/                # Layer 3：決策引擎
│   │   ├── detector.ts           # 套利機會偵測
│   │   ├── validator.ts          # 假陽性過濾（確認機制）
│   │   └── risk-guard.ts         # 風控邏輯
│   │
│   ├── execution/                # Layer 4：交易執行
│   │   ├── clob-client.ts        # Polymarket CLOB REST 封裝
│   │   ├── order-builder.ts      # 訂單建構 & EIP-712 簽名
│   │   └── dry-run.ts            # 乾跑模式攔截器
│   │
│   └── monitoring/               # Layer 5：監控
│       ├── db.ts                 # SQLite 交易日誌
│       ├── pnl-tracker.ts        # 損益計算
│       └── telegram-alert.ts     # Telegram 即時通知
│
├── tests/                        # 單元 & 整合測試
├── .env.example
├── bunfig.toml
└── package.json
```

---

## 5. Module A：電競時差套利（Esports Parser）

### 5.1 策略原理

電競比賽（LOL、Dota 2、CS2）的官方 API 提供毫秒級的即時遊戲數據，而 Twitch/YouTube 直播有 **15–40 秒**的串流延遲。Polymarket 上的一般使用者透過直播看比賽並更新報價，機器人直連官方 API 則早他們 15–40 秒知道賽況。

> ⚡ **關鍵時機**：當「龍」「Baron」「高地」「比賽結束」等高勝率影響事件發生後，立即估算新的勝率，並在 Polymarket 仍顯示舊機率時下單。

### 5.2 支援遊戲與 API

| 遊戲 | API 來源 | 關鍵觸發事件 |
|------|---------|------------|
| League of Legends | Riot Games Live Events API | 龍 / 男爵 / 高地塔 / 比賽結束 / 英雄擊殺超閾值 |
| Dota 2 | Steam Web API（GetLiveLeagueGames） | Roshan / 高地 / Mega Creep / 聖物獲取 |
| CS2 | PandaScore API | 地圖結束 / 整體局勢變化 |
| LOL 備援 | OpenDota / Faceit API | 數據補強，延遲稍高 |

### 5.3 事件觸發機率映射表

| 事件 | 機率影響（當先手） | 下注方向 |
|------|-----------------|---------|
| 拿到第一條龍 | 領先方勝率 +5–8% | 買入領先方 YES |
| 拿到 Baron | 領先方勝率 +15–25% | 強烈買入領先方 YES |
| 推倒第一座高地塔 | 勝率 +20–35% | 強烈買入 |
| 推倒第二座高地塔 | 勝率 +45–65% | 強烈買入 |
| 進入大龍 / Mega Creep | 勝率 > 80% | 大量買入 |
| 比賽結束（最後確認） | 100% 確定 | 清倉剩餘部位 |

### 5.4 TypeScript 核心實作

#### `src/types.ts` — 共用型別定義

```typescript
// src/types.ts
export type Side = 'YES' | 'NO';

export interface Market {
  question:    string;
  yesTokenId:  string;
  noTokenId:   string;
  yesPrice:    number;   // 0–1
  noPrice:     number;
  externalId?: string;   // 對應外部 API 的比賽 ID
  sport?:      'lol' | 'dota2' | 'cs2' | 'nba';
}

export interface Signal {
  trueProb:      number;  // 真實機率 [0,1]
  confidence:    number;  // 訊號可信度 [0,1]
  source:        string;  // 訊號來源說明
  triggeredBy?:  string;  // 觸發事件名稱
  timestamp:     number;  // Unix ms
}

export interface ArbOpportunity {
  market:      Market;
  signal:      Signal;
  side:        Side;
  edge:        number;   // 真實機率 - 市場價格
  tokenId:     string;
  price:       number;
  sizeUsd:     number;
}

export interface TradeResult {
  orderId:     string;
  status:      'filled' | 'cancelled' | 'dry_run';
  filledPrice: number;
  sizeUsd:     number;
  pnl?:        number;
}
```

#### `src/config.ts` — 全域設定

```typescript
// src/config.ts
export const CONFIG = {
  // ── 交易參數 ──
  minEdge:        0.08,   // 最低 8% 邊際（含 2% 手續費）
  kellyFraction:  0.25,   // 1/4 Kelly（保守）
  maxPositionUsd: 500,    // 單筆上限 USDC
  maxDailyLoss:   300,    // 日止損 USDC
  confirmCount:   2,      // 需連續 N 次訊號確認才下單（防假陽性）
  dryRun:         true,   // ⚠️ 上線前必須設 false

  // ── Polymarket 端點 ──
  clobHost:  'https://clob.polymarket.com',
  gammaHost: 'https://gamma-api.polymarket.com',
  wssHost:   'wss://ws-subscriptions-clob.polymarket.com/ws/price',
  chainId:   137,

  // ── API Keys（從 .env 讀取）──
  polygonKey:     process.env.POLYGON_PRIVATE_KEY!,
  proxyAddress:   process.env.POLYMARKET_PROXY_ADDRESS!,
  riotApiKey:     process.env.RIOT_API_KEY!,
  steamApiKey:    process.env.STEAM_API_KEY!,
  oddsApiKey:     process.env.ODDS_API_KEY!,
  bdlApiKey:      process.env.BDL_API_KEY!,
  telegramToken:  process.env.TELEGRAM_BOT_TOKEN!,
  telegramChatId: process.env.TELEGRAM_CHAT_ID!,
} as const;
```

#### `src/data/esports/riot-client.ts` — Riot API 電競事件偵測

```typescript
// src/data/esports/riot-client.ts
import type { Signal } from '../../types';

interface LiveEvent {
  EventName: string;   // 'DragonKill' | 'BaronKill' | 'TurretKilled' | 'GameEnd'
  EventTime: number;   // 比賽進行秒數
  KillerName?: string;
  TeamID?: string;     // '100'=藍方 | '200'=紅方
}

// 每個事件的勝率影響映射
const EVENT_PROB_IMPACT: Record<string, number> = {
  'DragonKill':         0.06,   // 拿龍：+6%
  'BaronKill':          0.20,   // 拿 Baron：+20%
  'TurretKilled':       0.08,   // 推塔：+8%（高地塔 x2）
  'InhibitorKilled':    0.35,   // 推高地：+35%
  'InhibitorRespawned': -0.10,  // 高地重生：回調
  'GameEnd':            1.0,    // 比賽結束：100%
};

export class RiotLiveClient {
  // LOL Live Game API（在本機運行遊戲用 127.0.0.1，賽事用官方 Tournament API）
  private baseUrl = 'https://127.0.0.1:2999/liveclientdata';
  private lastEventTime = 0;
  private currentWinProb = 0.5;

  // 取得本場比賽即時事件列表
  async fetchLiveEvents(): Promise<LiveEvent[]> {
    const res = await fetch(`${this.baseUrl}/eventdata`);
    const data = await res.json() as { Events: LiveEvent[] };

    // 只回傳比上次輪詢後的新事件
    const newEvents = data.Events.filter(e => e.EventTime > this.lastEventTime);
    if (newEvents.length) this.lastEventTime = newEvents.at(-1)!.EventTime;
    return newEvents;
  }

  // 根據新事件更新勝率並產生訊號
  async processEvents(polymarketTeam: 'blue' | 'red'): Promise<Signal | null> {
    const events = await this.fetchLiveEvents();
    if (!events.length) return null;

    let probDelta = 0;
    let lastTrigger = '';

    for (const event of events) {
      const impact = EVENT_PROB_IMPACT[event.EventName] ?? 0;
      if (!impact) continue;

      // 判斷事件對 Polymarket 追蹤隊伍的影響方向
      const isOurTeam = (
        (polymarketTeam === 'blue' && event.TeamID === '100') ||
        (polymarketTeam === 'red'  && event.TeamID === '200')
      );
      probDelta += isOurTeam ? impact : -impact;
      lastTrigger = event.EventName;
    }

    if (probDelta === 0) return null;

    // 更新累積勝率（夾在 [0.02, 0.98] 避免極端值）
    this.currentWinProb = Math.max(0.02, Math.min(0.98,
      this.currentWinProb + probDelta
    ));

    return {
      trueProb:    this.currentWinProb,
      confidence:  Math.min(0.95, 0.5 + Math.abs(probDelta) * 2),
      source:      'riot-live-api',
      triggeredBy: lastTrigger,
      timestamp:   Date.now(),
    };
  }
}
```

#### `src/arbitrage/detector.ts` — 套利偵測核心

```typescript
// src/arbitrage/detector.ts
import type { Market, Signal, ArbOpportunity } from '../types';
import { CONFIG } from '../config';

export class ArbDetector {
  // 訊號確認計數（防假陽性：需連續 N 次才觸發）
  private confirmCounts = new Map<string, number>();

  detect(market: Market, signal: Signal): ArbOpportunity | null {
    const edgeYes = signal.trueProb - market.yesPrice;
    const edgeNo  = (1 - signal.trueProb) - market.noPrice;

    // 選擇最佳方向
    const bestEdge = Math.max(edgeYes, edgeNo);
    const side: 'YES' | 'NO' = edgeYes >= edgeNo ? 'YES' : 'NO';

    // 邊際不足 → 跳過並重置計數器
    if (bestEdge < CONFIG.minEdge) {
      this.confirmCounts.delete(market.yesTokenId);
      return null;
    }

    // 確認機制：需連續 N 次偵測到才真正下單
    const key   = market.yesTokenId;
    const count = (this.confirmCounts.get(key) ?? 0) + 1;
    this.confirmCounts.set(key, count);
    if (count < CONFIG.confirmCount) return null;
    this.confirmCounts.delete(key); // 重置，等待下一次機會

    const tokenId = side === 'YES' ? market.yesTokenId : market.noTokenId;
    const price   = side === 'YES' ? market.yesPrice   : market.noPrice;

    // Kelly 準則計算部位大小
    const b      = (1 / price) - 1;
    const p      = side === 'YES' ? signal.trueProb : 1 - signal.trueProb;
    const kelly  = Math.max(0, (b * p - (1 - p)) / b);
    const sizeUsd = Math.min(
      CONFIG.maxPositionUsd,
      kelly * CONFIG.kellyFraction * 10000  // 以 10,000 USDC 總資金計
    );

    if (sizeUsd < 5) return null; // 太小不值得交易

    return { market, signal, side, edge: bestEdge, tokenId, price, sizeUsd };
  }
}
```

#### `src/execution/clob-client.ts` — CLOB API 封裝

```typescript
// src/execution/clob-client.ts
// 注意：Polymarket 官方僅提供 Python SDK（py-clob-client）
// 本模組使用 Bun 直接呼叫 CLOB REST API，自行處理 HMAC-SHA256 認證
import { createHmac } from 'crypto';
import type { ArbOpportunity, TradeResult } from '../types';
import { CONFIG } from '../config';

interface ApiCreds {
  apiKey:     string;
  secret:     string;
  passphrase: string;
}

export class ClobClient {
  constructor(private creds: ApiCreds) {}

  // 建構 L2 HMAC-SHA256 認證標頭
  private buildHeaders(method: string, path: string, body = ''): Headers {
    const timestamp = (Date.now() / 1000).toFixed(0);
    const message   = timestamp + method.toUpperCase() + path + body;
    const secret    = Buffer.from(this.creds.secret, 'base64');
    const sig       = createHmac('sha256', secret).update(message).digest('base64');

    const h = new Headers();
    h.set('Content-Type',    'application/json');
    h.set('POLY_ADDRESS',    process.env.POLYMARKET_PROXY_ADDRESS!);
    h.set('POLY_API_KEY',    this.creds.apiKey);
    h.set('POLY_PASSPHRASE', this.creds.passphrase);
    h.set('POLY_TIMESTAMP',  timestamp);
    h.set('POLY_SIGNATURE',  sig);
    return h;
  }

  // 取得當前市場中間價
  async getMidpoint(tokenId: string): Promise<number> {
    const res  = await fetch(`${CONFIG.clobHost}/midpoint?token_id=${tokenId}`);
    const data = await res.json() as { mid: string };
    return parseFloat(data.mid);
  }

  // 提交 FOK 市價單（Fill-Or-Kill：必須完全成交否則取消）
  async submitFokOrder(opp: ArbOpportunity): Promise<TradeResult> {
    const body = JSON.stringify({
      token_id:   opp.tokenId,
      amount:     opp.sizeUsd,
      side:       'BUY',
      order_type: 'FOK',
    });

    const path    = '/order';
    const headers = this.buildHeaders('POST', path, body);
    const res     = await fetch(`${CONFIG.clobHost}${path}`, {
      method: 'POST',
      headers,
      body,
    });

    const data = await res.json() as { orderID: string; status: string };
    return {
      orderId:     data.orderID ?? 'UNKNOWN',
      status:      data.status === 'filled' ? 'filled' : 'cancelled',
      filledPrice: opp.price,
      sizeUsd:     opp.sizeUsd,
    };
  }
}
```

---

## 6. Module B：NBA 即時勝率套利

### 6.1 策略原理

NBA 比賽進行中，每一次重要的比分變化（超車、關鍵三分、末節反超）都會造成真實勝率的非線性跳躍。機器人使用 Live Win Probability 模型即時計算真實勝率，並以 Pinnacle 尖銳賠率作為交叉確認，在 Polymarket 市場反應前搶先下注。

> 🔵 **雙重確認機制**：NBA 模組同時使用「即時比分 WP 模型」和「Pinnacle 賠率」兩個獨立訊號。只有兩者同方向且差距均超過門檻，才會觸發下單，大幅降低假陽性。

### 6.2 Live Win Probability 數學模型

```typescript
// src/signals/wp-models/nba-wp.ts
export interface GameState {
  scoreDiff:   number;   // 主隊得分 - 客隊得分（正=主隊領先）
  period:      number;   // 1–4（正規），5=OT
  timeLeft:    string;   // 格式 'MM:SS'
  isPlayoffs?: boolean;
}

export function calcNbaWinProb(state: GameState, forHome: boolean): number {
  const { scoreDiff, period, timeLeft, isPlayoffs = false } = state;

  // 計算剩餘分鐘數
  const [m, s]       = timeLeft.split(':').map(Number);
  const minutesLeft  = m + s / 60 + Math.max(0, 4 - period) * 12;

  // 主場優勢（常規賽約 +3.5 分，季後賽略降）
  const homeAdv      = isPlayoffs ? 2.5 : 3.5;
  const adjustedDiff = forHome
    ? scoreDiff + homeAdv
    : -scoreDiff - homeAdv;

  // Logistic 模型：隨剩餘時間縮短，比分差的影響指數增加
  const timeWeight = Math.sqrt(Math.max(minutesLeft, 0.1));
  const k          = 0.4 / timeWeight;
  const prob       = 1 / (1 + Math.exp(-k * adjustedDiff));

  return Math.max(0.02, Math.min(0.98, prob));
}
```

### 6.3 BallDontLie API 即時比分客戶端

```typescript
// src/data/nba/balldontlie.ts
import type { Signal } from '../../types';
import { calcNbaWinProb } from '../../signals/wp-models/nba-wp';
import { CONFIG } from '../../config';

interface BdlGame {
  id:                  number;
  status:              string;   // 'Final' | '4th Qtr 2:34' 等
  period:              number;
  time:                string;
  home_team_score:     number;
  visitor_team_score:  number;
  home_team: { abbreviation: string };
  visitor_team: { abbreviation: string };
}

export class NbaLiveClient {
  private base    = 'https://api.balldontlie.io/v1';
  private headers = { Authorization: CONFIG.bdlApiKey };

  async getLiveGames(): Promise<BdlGame[]> {
    const today = new Date().toISOString().split('T')[0];
    const res   = await fetch(
      `${this.base}/games?dates[]=${today}&per_page=15`,
      { headers: this.headers }
    );
    const { data } = await res.json() as { data: BdlGame[] };
    return data.filter(g => g.period > 0 && g.status !== 'Final');
  }

  async getSignal(externalGameId: string): Promise<Signal | null> {
    const games = await this.getLiveGames();
    const game  = games.find(g => String(g.id) === externalGameId);
    if (!game) return null;

    const prob = calcNbaWinProb({
      scoreDiff: game.home_team_score - game.visitor_team_score,
      period:    game.period,
      timeLeft:  game.time || '12:00',
    }, /* forHome= */ true);

    return {
      trueProb:   prob,
      confidence: 0.70,
      source:     'balldontlie-live',
      timestamp:  Date.now(),
    };
  }
}
```

### 6.4 Pinnacle 尖銳賠率客戶端

```typescript
// src/data/pinnacle-client.ts
import type { Signal } from '../types';
import { CONFIG } from '../config';

export class PinnaclecClient {
  private base = 'https://api.the-odds-api.com/v4/sports';

  // 取得 Pinnacle 隱含機率（已去除莊家優勢）
  async getSignal(eventId: string, sport: string): Promise<Signal | null> {
    try {
      const res   = await fetch(
        `${this.base}/${sport}/odds/?apiKey=${CONFIG.oddsApiKey}` +
        `&bookmakers=pinnacle&markets=h2h&oddsFormat=decimal`
      );
      const games = await res.json() as any[];
      const game  = games.find(g => g.id === eventId);
      if (!game) return null;

      const outcomes = game.bookmakers[0].markets[0].outcomes;
      const o1       = 1 / outcomes[0].price;  // 原始隱含機率（含莊家優勢）
      const o2       = 1 / outcomes[1].price;
      const total    = o1 + o2;                 // > 1.0

      // Normalization：去除莊家優勢 → 真實機率
      const trueProb = o1 / total;

      return {
        trueProb,
        confidence: 0.85,  // Pinnacle 是最準的博彩公司
        source:     'pinnacle',
        timestamp:  Date.now(),
      };
    } catch { return null; }
  }
}
```

---

## 7. 風控規則（Risk Guard）

### 7.1 實作

```typescript
// src/arbitrage/risk-guard.ts
import { CONFIG } from '../config';
import type { ArbOpportunity } from '../types';

export class RiskGuard {
  private dailyLoss   = 0;
  private totalExp    = 0;   // 當前總曝險 USDC
  private openCount   = 0;   // 開倉數量
  private lastTradeAt = 0;   // 最後交易時間（Unix ms）

  allow(opp: ArbOpportunity): boolean {
    // 規則 1：日止損
    if (this.dailyLoss >= CONFIG.maxDailyLoss) {
      console.warn('⛔ 日止損觸發，停止交易');
      return false;
    }
    // 規則 2：最大總曝險（不超過總資金 50%）
    if (this.totalExp + opp.sizeUsd > 5000) return false;
    // 規則 3：最大同時開倉數
    if (this.openCount >= 8) return false;
    // 規則 4：同一市場冷卻期（30 秒）
    if (Date.now() - this.lastTradeAt < 30_000) return false;
    // 規則 5：最低信心門檻
    if (opp.signal.confidence < 0.6) return false;
    // 規則 6：最低部位大小
    if (opp.sizeUsd < 5) return false;

    return true;
  }

  recordTrade(sizeUsd: number, pnl: number) {
    if (pnl < 0) this.dailyLoss += Math.abs(pnl);
    this.totalExp   += sizeUsd;
    this.openCount++;
    this.lastTradeAt = Date.now();
  }
}
```

### 7.2 風控參數一覽

| 風控規則 | 預設值 |
|---------|--------|
| 最低邊際要求（Min Edge） | 8%（覆蓋 2% 手續費 + 6% 利潤） |
| 單筆最大部位 | $500 USDC |
| 日最大虧損（止損） | $300 USDC |
| 總最大曝險 | $5,000 USDC（總資金 50%） |
| 最大同時開倉數 | 8 個市場 |
| 同市場冷卻期 | 30 秒 |
| 最低信心分數 | 0.60 |
| Kelly 比例 | 1/4 Kelly（保守模式） |

---

## 8. 主程式入口

```typescript
// src/main.ts
import { CONFIG } from './config';
import { RiotLiveClient  } from './data/esports/riot-client';
import { NbaLiveClient   } from './data/nba/balldontlie';
import { PinnaclecClient } from './data/pinnacle-client';
import { GammaScanner    } from './data/polymarket-gamma';
import { WsListener      } from './data/polymarket-ws';
import { ArbDetector     } from './arbitrage/detector';
import { RiskGuard       } from './arbitrage/risk-guard';
import { ClobClient      } from './execution/clob-client';
import { DryRun          } from './execution/dry-run';
import { DbLogger        } from './monitoring/db';
import { TelegramAlert   } from './monitoring/telegram-alert';

async function main() {
  console.log('🚀 PolyArb 啟動 | dry_run:', CONFIG.dryRun);

  const gamma    = new GammaScanner();
  const wsPrice  = new WsListener();
  const detector = new ArbDetector();
  const risk     = new RiskGuard();
  const clob     = new ClobClient({
    apiKey:     process.env.POLYMARKET_API_KEY!,
    secret:     process.env.POLYMARKET_SECRET!,
    passphrase: process.env.POLYMARKET_PASSPHRASE!,
  });
  const db       = new DbLogger();
  const tg       = new TelegramAlert();

  // ── Module A：電競套利循環 ──────────────────────────
  async function esportsLoop() {
    const riot = new RiotLiveClient();
    while (true) {
      try {
        const markets = await gamma.getEsportsMarkets();
        for (const market of markets) {
          const signal = await riot.processEvents('blue');
          if (!signal) continue;

          market.yesPrice = wsPrice.getLatestPrice(market.yesTokenId);

          const opp = detector.detect(market, signal);
          if (!opp || !risk.allow(opp)) continue;

          const result = CONFIG.dryRun
            ? DryRun.simulate(opp)
            : await clob.submitFokOrder(opp);

          db.log(opp, result);
          tg.notify(opp, result);
          risk.recordTrade(opp.sizeUsd, result.pnl ?? 0);
        }
      } catch (e) { console.error('[Esports]', e); }

      await Bun.sleep(500);  // 每 500ms 掃描一次
    }
  }

  // ── Module B：NBA 套利循環 ──────────────────────────
  async function nbaLoop() {
    const nba      = new NbaLiveClient();
    const pinnacle = new PinnaclecClient();
    while (true) {
      try {
        const markets = await gamma.getNbaMarkets();
        for (const market of markets) {
          const [liveSignal, pinnSignal] = await Promise.all([
            nba.getSignal(market.externalId!),
            pinnacle.getSignal(market.externalId!, 'basketball_nba'),
          ]);

          // 兩訊號加權合併（Pinnacle 60%，即時比分 40%）
          const mergedProb = liveSignal
            ? liveSignal.trueProb * 0.4 + (pinnSignal?.trueProb ?? liveSignal.trueProb) * 0.6
            : (pinnSignal?.trueProb ?? 0.5);

          const signal = {
            trueProb:   mergedProb,
            confidence: 0.75,
            source:     'nba-merged',
            timestamp:  Date.now(),
          };

          market.yesPrice = wsPrice.getLatestPrice(market.yesTokenId);
          const opp = detector.detect(market, signal);
          if (!opp || !risk.allow(opp)) continue;

          const result = CONFIG.dryRun
            ? DryRun.simulate(opp)
            : await clob.submitFokOrder(opp);

          db.log(opp, result);
          tg.notify(opp, result);
          risk.recordTrade(opp.sizeUsd, result.pnl ?? 0);
        }
      } catch (e) { console.error('[NBA]', e); }

      await Bun.sleep(1000);  // 每 1 秒掃描一次
    }
  }

  // 同時啟動兩個模組
  await Promise.all([esportsLoop(), nbaLoop()]);
}

main();
```

---

## 9. 環境設定與部署

### 9.1 環境變數

```bash
# .env.example

# Polygon 錢包（必填）
POLYGON_PRIVATE_KEY=0x...
POLYMARKET_PROXY_ADDRESS=0x...
POLYMARKET_API_KEY=...
POLYMARKET_SECRET=...
POLYMARKET_PASSPHRASE=...

# 電競 API
RIOT_API_KEY=RGAPI-...
STEAM_API_KEY=...

# NBA API
BDL_API_KEY=...          # BallDontLie
ODDS_API_KEY=...         # The Odds API（含 Pinnacle）

# 監控
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...

# 安全開關
DRY_RUN=true             # ⚠️ 上線前必須設 false
```

### 9.2 本機開發啟動

```bash
# 安裝 Bun（如尚未安裝）
curl -fsSL https://bun.sh/install | bash

# 建立專案
bun init polyarb && cd polyarb
bun add ws @types/ws

# 複製並填寫環境變數
cp .env.example .env

# 乾跑模式測試（不實際下單）
DRY_RUN=true bun run src/main.ts

# 查看即時日誌
tail -f polyarb.log
```

### 9.3 正式部署（VPS Docker）

```dockerfile
# Dockerfile
FROM oven/bun:latest
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
CMD ["bun", "run", "src/main.ts"]
```

```yaml
# docker-compose.yml
services:
  polyarb:
    build: .
    env_file: .env
    restart: unless-stopped
    volumes:
      - ./data:/app/data   # SQLite 持久化
      - ./logs:/app/logs
```

### 9.4 VPS 選擇建議

| VPS 提供商 | 建議地區 | 原因 |
|-----------|---------|------|
| **AWS EC2（t3.medium）** | us-east-1（維吉尼亞） | 最接近 Polymarket CLOB 伺服器，延遲 <5ms ✅ |
| Railway / Render | 美東 / 歐洲 | 快速部署，適合初期測試，延遲 ~20ms |
| 本機（台灣） | ❌ 不推薦正式運行 | 延遲 150–200ms，套利窗口 2.7 秒競爭激烈 |

---

## 10. 開發里程碑

| 階段 | 工作項目 | 週期 |
|------|---------|------|
| **Phase 1 — 基礎建設** | 建立 Bun TypeScript 骨架、Polymarket WS 監聽器、Gamma API 掃描、SQLite 日誌、乾跑模式 | Week 1–2 |
| **Phase 2 — 電競模組 A** | Riot Games Live API、事件機率映射、Esports WP 模型、套利偵測器 + 確認機制、乾跑驗證 > 1 週 | Week 3–4 |
| **Phase 3 — NBA 模組 B** | BallDontLie 即時比分、NBA Live WP 模型、Pinnacle 賠率、雙訊號合併邏輯、乾跑驗證 | Week 5–6 |
| **Phase 4 — 執行層** | CLOB REST API 封裝、EIP-712 訂單簽名、FOK 市價單、風控完整實作、Telegram 通知 | Week 7 |
| **Phase 5 — 上線** | 部署至 AWS us-east-1、小額真實資金（$200）測試、監控調參、逐步擴大規模 | Week 8+ |

---

## 11. 風險與注意事項

> ⚠️ **法規風險**：Polymarket 禁止美國居民交易，台灣目前未受限，但需持續關注監管動態。

> ⚠️ **競爭風險**：套利窗口已從 2024 年的 12.3 秒縮短至 2026 年的 2.7 秒，73% 利潤被 <100ms 機器人搶走，競爭持續激化。

> ⚠️ **流動性風險**：Polymarket 部分體育市場深度有限，大額下單可能造成滑價超過套利邊際。務必設定最小流動性門檻。

> ⚠️ **手續費結構**：Polymarket 對獲利方收取 2% 手續費，套利邊際必須 > 2.5–3% 才能真正獲利。

> 🔒 **安全警告**：私鑰請使用環境變數儲存，切勿硬編碼在程式碼中。GitHub 上曾出現竊取私鑰的惡意 Polymarket Bot 程式碼，請從官方 repo 取用。

---

*PolyArb PRD v1.0 | Plusblocks Technology Limited | 機密文件，請勿外傳*
