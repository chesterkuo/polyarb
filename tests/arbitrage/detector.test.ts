import { describe, it, expect } from 'bun:test';
import { ArbDetector } from '../../src/arbitrage/detector';
import type { Market, Signal } from '../../src/types';

const makeMarket = (yesPrice = 0.5): Market => ({
  id: 'm1', conditionId: 'c1', question: 'test',
  yesTokenId: 'y1', noTokenId: 'n1',
  yesPrice, noPrice: 1 - yesPrice,
  negRisk: false, tickSize: 0.01,
});

const makeSignal = (trueProb: number, confidence: number): Signal => ({
  trueProb, confidence, source: 'test', timestamp: Date.now(),
});

describe('ArbDetector', () => {
  it('returns null when edge is below minimum', () => {
    const d = new ArbDetector();
    expect(d.detect(makeMarket(0.5), makeSignal(0.55, 0.9))).toBeNull();
  });

  it('executes immediately on high confidence (>= 0.85)', () => {
    const d = new ArbDetector();
    const result = d.detect(makeMarket(0.5), makeSignal(0.7, 0.9));
    expect(result).not.toBeNull();
    expect(result!.side).toBe('YES');
    expect(result!.edge).toBeCloseTo(0.2);
  });

  it('requires 1 confirmation for medium confidence (0.70-0.85)', () => {
    const d = new ArbDetector();
    const s = makeSignal(0.7, 0.75);
    expect(d.detect(makeMarket(0.5), s)).toBeNull();
    expect(d.detect(makeMarket(0.5), s)).not.toBeNull();
  });

  it('requires 2 confirmations for low confidence (< 0.70)', () => {
    const d = new ArbDetector();
    const s = makeSignal(0.7, 0.65);
    expect(d.detect(makeMarket(0.5), s)).toBeNull();
    expect(d.detect(makeMarket(0.5), s)).toBeNull();
    expect(d.detect(makeMarket(0.5), s)).not.toBeNull();
  });

  it('resets confirmation count when edge disappears', () => {
    const d = new ArbDetector();
    d.detect(makeMarket(0.5), makeSignal(0.7, 0.65));
    d.detect(makeMarket(0.5), makeSignal(0.52, 0.65));
    expect(d.detect(makeMarket(0.5), makeSignal(0.7, 0.65))).toBeNull();
  });

  it('selects NO side when NO edge is bigger', () => {
    const d = new ArbDetector();
    const result = d.detect(makeMarket(0.5), makeSignal(0.3, 0.9));
    expect(result).not.toBeNull();
    expect(result!.side).toBe('NO');
  });
});
