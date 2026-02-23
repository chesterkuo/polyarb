import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { TelegramAlert } from '../../src/monitoring/telegram-alert';
import type { ArbOpportunity, TradeResult } from '../../src/types';

describe('TelegramAlert', () => {
  let tg: TelegramAlert;
  let fetchCalls: { url: string; body: string }[];
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchCalls = [];
    globalThis.fetch = mock((url: string, init: any) => {
      fetchCalls.push({ url, body: init?.body });
      return Promise.resolve(new Response('ok'));
    }) as any;
    tg = new TelegramAlert('test-token', 'test-chat');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends trade notification', async () => {
    const opp: ArbOpportunity = {
      market: { id: 'm1', conditionId: 'c1', question: 'Will T1 win?', yesTokenId: 'y1', noTokenId: 'n1', yesPrice: 0.5, noPrice: 0.5, negRisk: false, tickSize: 0.01 },
      signal: { trueProb: 0.7, confidence: 0.9, source: 'test', timestamp: Date.now() },
      side: 'YES', edge: 0.2, tokenId: 'y1', price: 0.5, sizeUsd: 100,
    };
    const result: TradeResult = { orderId: 'o1', status: 'filled', filledPrice: 0.5, sizeUsd: 100 };
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
