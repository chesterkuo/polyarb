import { describe, it, expect, beforeEach } from 'bun:test';
import { RiskGuard } from '../../src/arbitrage/risk-guard';
import type { ArbOpportunity } from '../../src/types';

const makeOpp = (marketId = 'm1', sizeUsd = 100, confidence = 0.8): ArbOpportunity => ({
  market: { id: marketId, conditionId: 'c1', question: 'test', yesTokenId: 'y1', noTokenId: 'n1', yesPrice: 0.5, noPrice: 0.5, negRisk: false, tickSize: 0.01 },
  signal: { trueProb: 0.7, confidence, source: 'test', timestamp: Date.now() },
  side: 'YES', edge: 0.2, tokenId: 'y1', price: 0.5, sizeUsd,
});

describe('RiskGuard', () => {
  let guard: RiskGuard;
  beforeEach(() => { guard = new RiskGuard(); });

  it('allows first trade', () => {
    expect(guard.allow(makeOpp())).toBe(true);
  });

  it('blocks when daily loss exceeded', () => {
    guard.recordOpen('p1', 100);
    guard.recordClose('p1', 100, -301);
    expect(guard.allow(makeOpp())).toBe(false);
  });

  it('blocks when max exposure exceeded', () => {
    for (let i = 0; i < 5; i++) guard.recordOpen(`p${i}`, 1100);
    expect(guard.allow(makeOpp('m2', 1000))).toBe(false);
  });

  it('blocks when max open positions exceeded', () => {
    for (let i = 0; i < 8; i++) guard.recordOpen(`p${i}`, 10);
    expect(guard.allow(makeOpp('m2'))).toBe(false);
  });

  it('blocks during cooldown for same market', () => {
    guard.recordOpen('p1', 100);
    guard.setLastTradeTime('m1', Date.now());
    expect(guard.allow(makeOpp('m1'))).toBe(false);
  });

  it('allows different market during cooldown', () => {
    guard.setLastTradeTime('m1', Date.now());
    expect(guard.allow(makeOpp('m2'))).toBe(true);
  });

  it('blocks when confidence below minimum', () => {
    expect(guard.allow(makeOpp('m1', 100, 0.3))).toBe(false);
  });

  it('unblocks after position close', () => {
    for (let i = 0; i < 8; i++) guard.recordOpen(`p${i}`, 10);
    guard.recordClose('p0', 10, 5);
    expect(guard.allow(makeOpp('m2'))).toBe(true);
  });
});
