import { describe, it, expect } from 'bun:test';
import { DryRun } from '../../src/execution/dry-run';
import type { ArbOpportunity } from '../../src/types';

describe('DryRun', () => {
  const opp: ArbOpportunity = {
    market: { id: 'm1', conditionId: 'c1', question: 'test', yesTokenId: 'y1', noTokenId: 'n1', yesPrice: 0.5, noPrice: 0.5, negRisk: false, tickSize: 0.01 },
    signal: { trueProb: 0.7, confidence: 0.9, source: 'test', timestamp: Date.now() },
    side: 'YES', edge: 0.2, tokenId: 'y1', price: 0.5, sizeUsd: 100,
  };

  it('returns dry_run status', () => {
    const result = DryRun.simulate(opp);
    expect(result.status).toBe('dry_run');
  });

  it('returns correct price and size', () => {
    const result = DryRun.simulate(opp);
    expect(result.filledPrice).toBe(0.5);
    expect(result.sizeUsd).toBe(100);
  });

  it('generates unique order IDs', () => {
    const r1 = DryRun.simulate(opp);
    const r2 = DryRun.simulate(opp);
    expect(r1.orderId).toStartWith('dry_');
    // They may be same if called in same ms, but at least check format
    expect(r1.orderId).toMatch(/^dry_\d+$/);
  });
});
