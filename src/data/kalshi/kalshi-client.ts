import type { Market, Sport, SportGame } from '../../types';
import { fetchWithRetry } from '../../utils/fetch-retry';

// ─── Kalshi API types ────────────────────────────────────────────────────────

const BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2';

const SERIES_TICKERS: Record<string, string> = {
  nba: 'KXNBAGAME',
  ncaab: 'KXNCAAMBGAME',
  nhl: 'KXNHLGAME',
};

export interface KalshiMarket {
  ticker: string;
  title: string;
  yesBid: number;     // cents (0-100)
  yesAsk: number;     // cents (0-100)
  noBid: number;      // cents (0-100)
  noAsk: number;      // cents (0-100)
  volume: number;
  openInterest: number;
  yesSubTitle: string;
  eventTicker: string;
}

export interface KalshiOrderBook {
  yes: Map<number, number>;  // price (cents) → quantity
  no: Map<number, number>;
}

export interface LiquidityCheck {
  canFill: boolean;
  avgPrice: number;     // decimal (0-1)
  availableQty: number; // contracts
}

// ─── Raw API response shapes ─────────────────────────────────────────────────

interface KalshiMarketRaw {
  ticker: string;
  title: string;
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  volume: number;
  open_interest: number;
  yes_sub_title: string;
  event_ticker: string;
}

interface KalshiMarketsResponse {
  cursor: string;
  markets: KalshiMarketRaw[];
}

interface KalshiOrderBookResponse {
  orderbook: {
    yes: Array<[number, number]> | Record<string, number>;
    no: Array<[number, number]> | Record<string, number>;
  };
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class KalshiClient {
  private cachedMarkets = new Map<string, KalshiMarket[]>();
  private cacheTime = new Map<string, number>();

  async getGameMarkets(sport: 'nba' | 'ncaab' | 'nhl'): Promise<KalshiMarket[]> {
    const seriesTicker = SERIES_TICKERS[sport];
    if (!seriesTicker) return [];

    // 30-second cache
    const now = Date.now();
    const cached = this.cachedMarkets.get(sport);
    const lastFetch = this.cacheTime.get(sport) ?? 0;
    if (cached && now - lastFetch < 30_000) return cached;

    try {
      const all: KalshiMarket[] = [];
      let cursor: string | undefined;

      // Paginate through all open markets for this series
      for (let page = 0; page < 10; page++) {
        const params = new URLSearchParams({
          series_ticker: seriesTicker,
          status: 'open',
          limit: '200',
        });
        if (cursor) params.set('cursor', cursor);

        const res = await fetchWithRetry(`${BASE_URL}/markets?${params}`);
        if (!res.ok) break;

        const data = (await res.json()) as KalshiMarketsResponse;
        if (!data.markets?.length) break;

        for (const raw of data.markets) {
          all.push({
            ticker: raw.ticker,
            title: raw.title,
            yesBid: raw.yes_bid ?? 0,
            yesAsk: raw.yes_ask ?? 0,
            noBid: raw.no_bid ?? 0,
            noAsk: raw.no_ask ?? 0,
            volume: raw.volume ?? 0,
            openInterest: raw.open_interest ?? 0,
            yesSubTitle: raw.yes_sub_title ?? '',
            eventTicker: raw.event_ticker ?? '',
          });
        }

        cursor = data.cursor;
        if (!cursor) break;
      }

      this.cachedMarkets.set(sport, all);
      this.cacheTime.set(sport, now);
      return all;
    } catch (err) {
      console.error(`[Kalshi] getGameMarkets(${sport}) error:`, err);
      return [];
    }
  }

  async getOrderBook(ticker: string): Promise<KalshiOrderBook | null> {
    try {
      const res = await fetchWithRetry(`${BASE_URL}/markets/${ticker}/orderbook`);
      if (!res.ok) return null;

      const data = (await res.json()) as KalshiOrderBookResponse;
      const ob = data.orderbook;
      if (!ob) return null;

      return {
        yes: parseBookSide(ob.yes),
        no: parseBookSide(ob.no),
      };
    } catch (err) {
      console.error(`[Kalshi] getOrderBook(${ticker}) error:`, err);
      return null;
    }
  }

  matchGameToMarket(game: SportGame, markets: KalshiMarket[]): KalshiMarket | null {
    const homeAbbr = game.homeTeam.abbreviation.toUpperCase();
    const awayAbbr = game.awayTeam.abbreviation.toUpperCase();
    const homeName = game.homeTeam.name.toLowerCase();
    const awayName = game.awayTeam.name.toLowerCase();

    // Strategy 1: Match by team abbreviations in ticker
    // Kalshi tickers look like: KXNBAGAME-26FEB26OKCDET-OKC
    // The middle segment contains both team abbreviations concatenated
    for (const m of markets) {
      const upper = m.ticker.toUpperCase();
      if (upper.includes(homeAbbr) && upper.includes(awayAbbr)) {
        return m;
      }
    }

    // Strategy 2: Match by team name in title or yesSubTitle
    for (const m of markets) {
      const title = m.title.toLowerCase();
      const sub = m.yesSubTitle.toLowerCase();
      const text = title + ' ' + sub;
      if ((text.includes(homeName) || text.includes(awayName)) &&
          (text.includes(homeName) && text.includes(awayName))) {
        return m;
      }
    }

    return null;
  }

  checkLiquidity(
    orderBook: KalshiOrderBook,
    side: 'yes' | 'no',
    targetPriceCents: number,
    sizeUsd: number,
  ): LiquidityCheck {
    const book = side === 'yes' ? orderBook.yes : orderBook.no;

    // Sort prices: for buying YES we want lowest asks first
    // The book contains prices where orders are resting
    // For YES: we buy at ask prices (ascending)
    // For NO: we buy at ask prices (ascending)
    const entries = Array.from(book.entries())
      .filter(([price]) => price <= targetPriceCents)
      .sort((a, b) => a[0] - b[0]);

    let filledQty = 0;
    let totalCost = 0;
    const neededContracts = Math.ceil(sizeUsd * 100 / targetPriceCents); // approx contracts

    for (const [priceCents, qty] of entries) {
      const take = Math.min(qty, neededContracts - filledQty);
      filledQty += take;
      totalCost += take * priceCents;
      if (filledQty >= neededContracts) break;
    }

    const avgPriceCents = filledQty > 0 ? totalCost / filledQty : targetPriceCents;

    return {
      canFill: filledQty >= neededContracts,
      avgPrice: avgPriceCents / 100,
      availableQty: filledQty,
    };
  }

  toMarket(km: KalshiMarket, sport?: Sport): Market {
    return {
      id: km.ticker,
      conditionId: km.eventTicker,
      question: km.title,
      yesTokenId: km.ticker,
      noTokenId: km.ticker,
      yesPrice: km.yesAsk / 100,
      noPrice: km.noAsk / 100,
      negRisk: false,
      tickSize: 0.01,
      sport,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseBookSide(
  raw: Array<[number, number]> | Record<string, number> | undefined,
): Map<number, number> {
  const map = new Map<number, number>();
  if (!raw) return map;

  if (Array.isArray(raw)) {
    for (const [price, qty] of raw) {
      map.set(price, qty);
    }
  } else {
    for (const [priceStr, qty] of Object.entries(raw)) {
      map.set(Number(priceStr), qty);
    }
  }
  return map;
}
