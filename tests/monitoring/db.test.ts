import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { DbLogger } from '../../src/monitoring/db';
import type { ArbOpportunity, TradeResult } from '../../src/types';

describe('DbLogger', () => {
  let db: DbLogger;

  beforeEach(() => { db = new DbLogger(':memory:'); });
  afterEach(() => { db.close(); });

  it('creates tables on init', () => {
    const tables = db.getDb().query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('trades');
    expect(names).toContain('signals');
    expect(names).toContain('daily_summary');
  });

  it('logs a trade', () => {
    const opp: ArbOpportunity = {
      market: { id: 'm1', conditionId: 'c1', question: 'test', yesTokenId: 'y1', noTokenId: 'n1', yesPrice: 0.5, noPrice: 0.5, negRisk: false, tickSize: 0.01 },
      signal: { trueProb: 0.7, confidence: 0.9, source: 'test', timestamp: Date.now() },
      side: 'YES', edge: 0.2, tokenId: 'y1', price: 0.5, sizeUsd: 100,
    };
    const result: TradeResult = { orderId: 'o1', status: 'filled', filledPrice: 0.5, sizeUsd: 100, pnl: 20 };
    db.logTrade(opp, result);
    const rows = db.getDb().query('SELECT * FROM trades').all();
    expect(rows).toHaveLength(1);
  });

  it('logs a signal', () => {
    db.logSignal('m1', { trueProb: 0.7, confidence: 0.9, source: 'test', triggeredBy: 'baron_kill', timestamp: Date.now() }, 0.5);
    const rows = db.getDb().query('SELECT * FROM signals').all();
    expect(rows).toHaveLength(1);
  });
});
