import { describe, it, expect, mock, afterEach } from 'bun:test';
import { KalshiClient, type KalshiMarket, type KalshiOrderBook } from '../../../src/data/kalshi/kalshi-client';
import type { SportGame } from '../../../src/types';

const originalFetch = globalThis.fetch;

describe('KalshiClient', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ─── Mock data ───────────────────────────────────────────────────────────

  const mockMarketRaw = (overrides: Record<string, any> = {}) => ({
    ticker: 'KXNBAGAME-26FEB26OKCDET-OKC',
    title: 'Will OKC Thunder beat the Detroit Pistons?',
    yes_bid: 72,
    yes_ask: 74,
    no_bid: 26,
    no_ask: 28,
    volume: 150000,
    open_interest: 8500,
    yes_sub_title: 'Oklahoma City Thunder',
    event_ticker: 'KXNBAGAME-26FEB26OKCDET',
    ...overrides,
  });

  const mockMarketsResponse = (markets: any[] = [mockMarketRaw()]) => ({
    cursor: '',
    markets,
  });

  const mockOrderBookResponse = () => ({
    orderbook: {
      yes: { '72': 100, '73': 200, '74': 150 },
      no: { '26': 120, '27': 180, '28': 100 },
    },
  });

  const mockGame = (overrides: Partial<SportGame> = {}): SportGame => ({
    id: '401650001',
    sport: 'nba',
    homeTeam: { name: 'Detroit Pistons', abbreviation: 'DET', score: 45 },
    awayTeam: { name: 'Oklahoma City Thunder', abbreviation: 'OKC', score: 58 },
    period: 2,
    clock: '5:30',
    status: 'in_progress',
    ...overrides,
  });

  // ─── getGameMarkets ──────────────────────────────────────────────────────

  describe('getGameMarkets', () => {
    it('fetches and parses NBA markets', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify(mockMarketsResponse())))
      ) as any;

      const client = new KalshiClient();
      const markets = await client.getGameMarkets('nba');

      expect(markets).toHaveLength(1);
      expect(markets[0].ticker).toBe('KXNBAGAME-26FEB26OKCDET-OKC');
      expect(markets[0].title).toBe('Will OKC Thunder beat the Detroit Pistons?');
      expect(markets[0].yesBid).toBe(72);
      expect(markets[0].yesAsk).toBe(74);
      expect(markets[0].noBid).toBe(26);
      expect(markets[0].noAsk).toBe(28);
      expect(markets[0].volume).toBe(150000);
      expect(markets[0].yesSubTitle).toBe('Oklahoma City Thunder');
    });

    it('uses correct series ticker for each sport', async () => {
      const calls: string[] = [];
      globalThis.fetch = mock((url: string) => {
        calls.push(url);
        return Promise.resolve(new Response(JSON.stringify(mockMarketsResponse([]))));
      }) as any;

      const client = new KalshiClient();
      await client.getGameMarkets('nba');
      await client.getGameMarkets('ncaab');
      await client.getGameMarkets('nhl');

      expect(calls[0]).toContain('series_ticker=KXNBAGAME');
      expect(calls[1]).toContain('series_ticker=KXNCAAMBGAME');
      expect(calls[2]).toContain('series_ticker=KXNHLGAME');
    });

    it('returns empty array on invalid JSON response', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('not json', { status: 200 }))
      ) as any;

      const client = new KalshiClient();
      const markets = await client.getGameMarkets('nba');
      expect(markets).toHaveLength(0);
    });

    it('returns empty array on non-ok response', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('error', { status: 500 }))
      ) as any;

      const client = new KalshiClient();
      const markets = await client.getGameMarkets('nba');
      expect(markets).toHaveLength(0);
    });

    it('caches results for 30 seconds', async () => {
      let callCount = 0;
      globalThis.fetch = mock(() => {
        callCount++;
        return Promise.resolve(new Response(JSON.stringify(mockMarketsResponse())));
      }) as any;

      const client = new KalshiClient();
      await client.getGameMarkets('nba');
      await client.getGameMarkets('nba');

      // Second call should use cache, only 1 fetch
      expect(callCount).toBe(1);
    });

    it('handles multiple markets', async () => {
      const markets = [
        mockMarketRaw(),
        mockMarketRaw({
          ticker: 'KXNBAGAME-26FEB26LALCLE-LAL',
          title: 'Will LA Lakers beat the Cleveland Cavaliers?',
          yes_bid: 45,
          yes_ask: 47,
        }),
      ];
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify(mockMarketsResponse(markets))))
      ) as any;

      const client = new KalshiClient();
      const result = await client.getGameMarkets('nba');
      expect(result).toHaveLength(2);
      expect(result[1].ticker).toBe('KXNBAGAME-26FEB26LALCLE-LAL');
    });
  });

  // ─── getOrderBook ────────────────────────────────────────────────────────

  describe('getOrderBook', () => {
    it('parses orderbook from object format', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify(mockOrderBookResponse())))
      ) as any;

      const client = new KalshiClient();
      const ob = await client.getOrderBook('KXNBAGAME-26FEB26OKCDET-OKC');

      expect(ob).not.toBeNull();
      expect(ob!.yes.get(72)).toBe(100);
      expect(ob!.yes.get(73)).toBe(200);
      expect(ob!.yes.get(74)).toBe(150);
      expect(ob!.no.get(26)).toBe(120);
      expect(ob!.no.get(27)).toBe(180);
    });

    it('parses orderbook from array format', async () => {
      const arrayFormat = {
        orderbook: {
          yes: [[72, 100], [73, 200]],
          no: [[28, 150]],
        },
      };
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify(arrayFormat)))
      ) as any;

      const client = new KalshiClient();
      const ob = await client.getOrderBook('KXNBAGAME-26FEB26OKCDET-OKC');

      expect(ob).not.toBeNull();
      expect(ob!.yes.get(72)).toBe(100);
      expect(ob!.yes.get(73)).toBe(200);
      expect(ob!.no.get(28)).toBe(150);
    });

    it('returns null on invalid JSON response', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('not json', { status: 200 }))
      ) as any;

      const client = new KalshiClient();
      const ob = await client.getOrderBook('KXNBAGAME-26FEB26OKCDET-OKC');
      expect(ob).toBeNull();
    });

    it('returns null on non-ok response', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('not found', { status: 404 }))
      ) as any;

      const client = new KalshiClient();
      const ob = await client.getOrderBook('KXNBAGAME-26FEB26OKCDET-OKC');
      expect(ob).toBeNull();
    });
  });

  // ─── matchGameToMarket ───────────────────────────────────────────────────

  describe('matchGameToMarket', () => {
    it('matches by team abbreviations in ticker', () => {
      const client = new KalshiClient();
      const game = mockGame();
      const markets: KalshiMarket[] = [
        {
          ticker: 'KXNBAGAME-26FEB26OKCDET-OKC',
          title: 'Will OKC beat DET?',
          yesBid: 72, yesAsk: 74, noBid: 26, noAsk: 28,
          volume: 100000, openInterest: 5000,
          yesSubTitle: 'Oklahoma City Thunder',
          eventTicker: 'KXNBAGAME-26FEB26OKCDET',
        },
      ];

      const match = client.matchGameToMarket(game, markets);
      expect(match).not.toBeNull();
      expect(match!.ticker).toBe('KXNBAGAME-26FEB26OKCDET-OKC');
    });

    it('falls back to team name matching', () => {
      const client = new KalshiClient();
      const game = mockGame();
      const markets: KalshiMarket[] = [
        {
          ticker: 'SOME-OTHER-TICKER',
          title: 'Will Oklahoma City Thunder beat the Detroit Pistons?',
          yesBid: 72, yesAsk: 74, noBid: 26, noAsk: 28,
          volume: 100000, openInterest: 5000,
          yesSubTitle: 'Oklahoma City Thunder',
          eventTicker: 'EVT1',
        },
      ];

      const match = client.matchGameToMarket(game, markets);
      expect(match).not.toBeNull();
    });

    it('returns null when no match found', () => {
      const client = new KalshiClient();
      const game = mockGame();
      const markets: KalshiMarket[] = [
        {
          ticker: 'KXNBAGAME-26FEB26LALCLE-LAL',
          title: 'Will LA Lakers beat the Cleveland Cavaliers?',
          yesBid: 45, yesAsk: 47, noBid: 53, noAsk: 55,
          volume: 80000, openInterest: 3000,
          yesSubTitle: 'Los Angeles Lakers',
          eventTicker: 'EVT2',
        },
      ];

      const match = client.matchGameToMarket(game, markets);
      expect(match).toBeNull();
    });

    it('handles NCAAB game tickers', () => {
      const client = new KalshiClient();
      const game = mockGame({
        sport: 'ncaab',
        homeTeam: { name: 'Duke Blue Devils', abbreviation: 'DUKE', score: 35 },
        awayTeam: { name: 'North Carolina Tar Heels', abbreviation: 'UNC', score: 30 },
      });
      const markets: KalshiMarket[] = [
        {
          ticker: 'KXNCAAMBGAME-26FEB26DUKUNC-DUKE',
          title: 'Will Duke beat UNC?',
          yesBid: 60, yesAsk: 62, noBid: 38, noAsk: 40,
          volume: 50000, openInterest: 2000,
          yesSubTitle: 'Duke Blue Devils',
          eventTicker: 'KXNCAAMBGAME-26FEB26DUKUNC',
        },
      ];

      const match = client.matchGameToMarket(game, markets);
      expect(match).not.toBeNull();
      expect(match!.ticker).toContain('DUK');
    });
  });

  // ─── checkLiquidity ──────────────────────────────────────────────────────

  describe('checkLiquidity', () => {
    const makeOrderBook = (): KalshiOrderBook => ({
      yes: new Map([[70, 50], [72, 100], [74, 200]]),
      no: new Map([[26, 80], [28, 120], [30, 150]]),
    });

    it('reports sufficient liquidity when book is deep', () => {
      const client = new KalshiClient();
      const ob = makeOrderBook();

      const result = client.checkLiquidity(ob, 'yes', 74, 5);
      expect(result.canFill).toBe(true);
      expect(result.availableQty).toBeGreaterThan(0);
      expect(result.avgPrice).toBeGreaterThan(0);
      expect(result.avgPrice).toBeLessThanOrEqual(0.74);
    });

    it('reports insufficient liquidity on thin book', () => {
      const client = new KalshiClient();
      const ob: KalshiOrderBook = {
        yes: new Map([[74, 1]]), // only 1 contract
        no: new Map(),
      };

      // Trying to fill $50 at 74 cents needs ~68 contracts
      const result = client.checkLiquidity(ob, 'yes', 74, 50);
      expect(result.canFill).toBe(false);
      expect(result.availableQty).toBe(1);
    });

    it('walks book from best to worst price', () => {
      const client = new KalshiClient();
      const ob: KalshiOrderBook = {
        yes: new Map([[70, 10], [72, 10], [74, 10]]),
        no: new Map(),
      };

      const result = client.checkLiquidity(ob, 'yes', 74, 5);
      expect(result.canFill).toBe(true);
      // Should fill at best prices first (70, then 72, then 74)
      expect(result.avgPrice).toBeLessThanOrEqual(0.74);
    });

    it('handles empty orderbook', () => {
      const client = new KalshiClient();
      const ob: KalshiOrderBook = {
        yes: new Map(),
        no: new Map(),
      };

      const result = client.checkLiquidity(ob, 'yes', 74, 10);
      expect(result.canFill).toBe(false);
      expect(result.availableQty).toBe(0);
    });

    it('checks NO side correctly', () => {
      const client = new KalshiClient();
      const ob = makeOrderBook();

      const result = client.checkLiquidity(ob, 'no', 30, 5);
      expect(result.canFill).toBe(true);
      expect(result.avgPrice).toBeLessThanOrEqual(0.30);
    });
  });

  // ─── toMarket ────────────────────────────────────────────────────────────

  describe('toMarket', () => {
    it('converts KalshiMarket to Market type', () => {
      const client = new KalshiClient();
      const km: KalshiMarket = {
        ticker: 'KXNBAGAME-26FEB26OKCDET-OKC',
        title: 'Will OKC beat DET?',
        yesBid: 72, yesAsk: 74, noBid: 26, noAsk: 28,
        volume: 150000, openInterest: 8500,
        yesSubTitle: 'Oklahoma City Thunder',
        eventTicker: 'KXNBAGAME-26FEB26OKCDET',
      };

      const market = client.toMarket(km, 'nba');

      expect(market.id).toBe('KXNBAGAME-26FEB26OKCDET-OKC');
      expect(market.conditionId).toBe('KXNBAGAME-26FEB26OKCDET');
      expect(market.question).toBe('Will OKC beat DET?');
      expect(market.yesPrice).toBeCloseTo(0.74, 2);
      expect(market.noPrice).toBeCloseTo(0.28, 2);
      expect(market.yesTokenId).toBe('KXNBAGAME-26FEB26OKCDET-OKC');
      expect(market.noTokenId).toBe('KXNBAGAME-26FEB26OKCDET-OKC');
      expect(market.sport).toBe('nba');
      expect(market.negRisk).toBe(false);
      expect(market.tickSize).toBe(0.01);
    });

    it('converts cents to decimal prices correctly', () => {
      const client = new KalshiClient();
      const km: KalshiMarket = {
        ticker: 'T1', title: 'Test', yesBid: 50, yesAsk: 52,
        noBid: 48, noAsk: 50, volume: 0, openInterest: 0,
        yesSubTitle: '', eventTicker: 'E1',
      };

      const market = client.toMarket(km);
      expect(market.yesPrice).toBeCloseTo(0.52, 2);
      expect(market.noPrice).toBeCloseTo(0.50, 2);
    });
  });
});
