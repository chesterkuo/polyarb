import { describe, it, expect, mock, afterEach } from 'bun:test';
import { GammaScanner } from '../../src/data/polymarket-gamma';

const originalFetch = globalThis.fetch;

describe('GammaScanner', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const rawMarket = (overrides: Record<string, any> = {}) => ({
    id: 'mkt-1', conditionId: 'cond-1', question: 'Will T1 win?',
    clobTokenIds: ['yes-tok', 'no-tok'], outcomePrices: ['0.65', '0.35'],
    active: true, closed: false, acceptingOrders: true,
    negRisk: false,
    ...overrides,
  });

  const wrapEvent = (title: string, markets: any[] = [rawMarket()]) => ({
    id: 'evt-1', title, active: true, closed: false, markets,
  });

  // Pagination-aware mock: returns data on first call, empty on subsequent
  function mockPaginatedFetch(events: any[]) {
    let called = false;
    globalThis.fetch = mock(() => {
      if (!called) {
        called = true;
        return Promise.resolve(new Response(JSON.stringify(events)));
      }
      return Promise.resolve(new Response(JSON.stringify([])));
    }) as any;
  }

  it('parses esports markets correctly', async () => {
    mockPaginatedFetch([wrapEvent('LoL: LCK Spring')]);

    const scanner = new GammaScanner();
    const markets = await scanner.getEsportsMarkets();
    expect(markets).toHaveLength(1);
    expect(markets[0].id).toBe('mkt-1');
    expect(markets[0].yesPrice).toBe(0.65);
    expect(markets[0].noPrice).toBe(0.35);
    expect(markets[0].yesTokenId).toBe('yes-tok');
    expect(markets[0].noTokenId).toBe('no-tok');
    expect(markets[0].negRisk).toBe(false);
    expect(markets[0].tickSize).toBe(0.01);
  });

  it('filters out inactive and closed markets', async () => {
    mockPaginatedFetch([
      wrapEvent('LoL: LCK Spring', [
        rawMarket(),
        rawMarket({ id: 'inactive', active: false }),
        rawMarket({ id: 'closed', closed: true }),
        rawMarket({ id: 'not-accepting', acceptingOrders: false }),
      ]),
    ]);

    const scanner = new GammaScanner();
    const markets = await scanner.getEsportsMarkets();
    expect(markets).toHaveLength(1);
    expect(markets[0].id).toBe('mkt-1');
  });

  it('handles negRisk flag for NBA markets', async () => {
    mockPaginatedFetch([
      wrapEvent('NBA: Lakers vs Celtics', [rawMarket({ negRisk: true })]),
    ]);

    const scanner = new GammaScanner();
    const markets = await scanner.getNbaMarkets();
    expect(markets[0].negRisk).toBe(true);
    expect(markets[0].sport).toBe('nba');
  });

  it('detects NCAAB markets', async () => {
    mockPaginatedFetch([
      wrapEvent('NCAAB: March Madness Round 1', [rawMarket()]),
    ]);

    const scanner = new GammaScanner();
    const markets = await scanner.getNcaabMarkets();
    expect(markets).toHaveLength(1);
    expect(markets[0].sport).toBe('ncaab');
  });

  it('detects NHL markets', async () => {
    mockPaginatedFetch([
      wrapEvent('NHL: Bruins vs Leafs', [rawMarket()]),
    ]);

    const scanner = new GammaScanner();
    const markets = await scanner.getNhlMarkets();
    expect(markets).toHaveLength(1);
    expect(markets[0].sport).toBe('nhl');
  });

  it('hockey keyword matches NHL', async () => {
    mockPaginatedFetch([
      wrapEvent('Ice Hockey: Stanley Cup', [rawMarket()]),
    ]);

    const scanner = new GammaScanner();
    const markets = await scanner.getNhlMarkets();
    expect(markets).toHaveLength(1);
  });
});
