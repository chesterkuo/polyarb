import { describe, it, expect, mock, afterEach } from 'bun:test';
import { PinnacleClient } from '../../src/data/pinnacle-client';

const originalFetch = globalThis.fetch;

describe('PinnacleClient', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('getSignal parses odds and computes implied probability', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify([
        {
          id: 'evt-1',
          bookmakers: [{
            key: 'pinnacle',
            markets: [{
              key: 'h2h',
              outcomes: [
                { name: 'Team A', price: 1.5 },
                { name: 'Team B', price: 2.8 },
              ],
            }],
          }],
        },
      ])))
    ) as any;

    const client = new PinnacleClient();
    const signal = await client.getSignal('evt-1', 'basketball_nba');
    expect(signal).not.toBeNull();
    expect(signal!.source).toBe('pinnacle');
    expect(signal!.confidence).toBe(0.85);
    // 1/1.5 = 0.6667, 1/2.8 = 0.3571, total = 1.0238, trueProb = 0.6667/1.0238 ~ 0.651
    expect(signal!.trueProb).toBeGreaterThan(0.6);
    expect(signal!.trueProb).toBeLessThan(0.7);
  });

  it('getSignal returns null for missing game', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify([
        {
          id: 'other-evt',
          bookmakers: [{
            key: 'pinnacle',
            markets: [{ key: 'h2h', outcomes: [{ name: 'A', price: 1.5 }, { name: 'B', price: 2.5 }] }],
          }],
        },
      ])))
    ) as any;

    const client = new PinnacleClient();
    const signal = await client.getSignal('nonexistent', 'basketball_nba');
    expect(signal).toBeNull();
  });

  it('getSignal returns null when response is invalid', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('not json', { headers: { 'content-type': 'text/plain' } }))
    ) as any;

    const client = new PinnacleClient();
    const signal = await client.getSignal('evt-1', 'basketball_nba');
    expect(signal).toBeNull();
  });
});
