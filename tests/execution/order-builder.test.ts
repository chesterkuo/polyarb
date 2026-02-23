import { describe, it, expect } from 'bun:test';
import { OrderBuilder } from '../../src/execution/order-builder';
import type { ArbOpportunity } from '../../src/types';

describe('OrderBuilder', () => {
  const builder = new OrderBuilder('0xProxy', '0xSigner');

  const opp: ArbOpportunity = {
    market: { id: 'm1', conditionId: 'c1', question: 'test', yesTokenId: 'y1', noTokenId: 'n1', yesPrice: 0.55, noPrice: 0.45, negRisk: false, tickSize: 0.01 },
    signal: { trueProb: 0.7, confidence: 0.9, source: 'test', timestamp: Date.now() },
    side: 'YES', edge: 0.15, tokenId: 'y1', price: 0.55, sizeUsd: 100,
  };

  it('builds order with correct maker/signer', () => {
    const order = builder.build(opp);
    expect(order.maker).toBe('0xProxy');
    expect(order.signer).toBe('0xSigner');
  });

  it('calculates makerAmount correctly (USDC * 1e6)', () => {
    const order = builder.build(opp);
    expect(order.makerAmount).toBe(String(Math.floor(100 * 1e6)));
  });

  it('calculates takerAmount correctly (size/price * 1e6)', () => {
    const order = builder.build(opp);
    expect(order.takerAmount).toBe(String(Math.floor((100 / 0.55) * 1e6)));
  });

  it('sets side to 0 (BUY)', () => {
    const order = builder.build(opp);
    expect(order.side).toBe(0);
  });

  it('sets signatureType to 1 (POLY_PROXY)', () => {
    const order = builder.build(opp);
    expect(order.signatureType).toBe(1);
  });

  it('sets zero address as taker', () => {
    const order = builder.build(opp);
    expect(order.taker).toBe('0x0000000000000000000000000000000000000000');
  });
});
