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
    tags: ['esports'], negRisk: false,
    ...overrides,
  });

  it('parses markets correctly', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify([rawMarket()])))
    ) as any;

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
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify([
        rawMarket(),
        rawMarket({ id: 'inactive', active: false }),
        rawMarket({ id: 'closed', closed: true }),
        rawMarket({ id: 'not-accepting', acceptingOrders: false }),
      ])))
    ) as any;

    const scanner = new GammaScanner();
    const markets = await scanner.getMarkets('esports');
    expect(markets).toHaveLength(1);
    expect(markets[0].id).toBe('mkt-1');
  });

  it('handles negRisk flag', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify([rawMarket({ negRisk: true })])))
    ) as any;

    const scanner = new GammaScanner();
    const markets = await scanner.getMarkets('nba');
    expect(markets[0].negRisk).toBe(true);
  });
});
