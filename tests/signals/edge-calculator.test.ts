import { describe, it, expect } from 'bun:test';
import { calcEdge, calcKellySize } from '../../src/signals/edge-calculator';

describe('calcEdge', () => {
  it('calculates positive YES edge', () => {
    const result = calcEdge(0.7, 0.5, 0.5);
    expect(result.side).toBe('YES');
    expect(result.edge).toBeCloseTo(0.2);
  });
  it('calculates positive NO edge', () => {
    const result = calcEdge(0.3, 0.5, 0.5);
    expect(result.side).toBe('NO');
    expect(result.edge).toBeCloseTo(0.2);
  });
  it('picks the larger edge', () => {
    const result = calcEdge(0.45, 0.40, 0.45);
    expect(result.side).toBe('NO');
    expect(result.edge).toBeCloseTo(0.1);
  });
});

describe('calcKellySize', () => {
  it('returns positive size for positive edge', () => {
    expect(calcKellySize(0.7, 0.5, 0.25, 10000)).toBeGreaterThan(0);
  });
  it('returns 0 for negative edge', () => {
    expect(calcKellySize(0.4, 0.5, 0.25, 10000)).toBe(0);
  });
  it('respects max position size', () => {
    expect(calcKellySize(0.99, 0.01, 0.25, 100000)).toBeLessThanOrEqual(500);
  });
  it('returns 0 for size below minimum', () => {
    expect(calcKellySize(0.51, 0.5, 0.25, 100)).toBe(0);
  });
});
