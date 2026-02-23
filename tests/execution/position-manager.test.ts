import { describe, it, expect, beforeEach } from 'bun:test';
import { PositionManager } from '../../src/execution/position-manager';
import type { OpenPosition } from '../../src/types';

const makePosition = (overrides: Partial<OpenPosition> = {}): OpenPosition => ({
  id: 'p1', marketId: 'm1', tokenId: 'y1', side: 'YES',
  entryPrice: 0.5, sizeUsd: 100, enteredAt: Date.now(),
  highWaterMark: 0, currentPrice: 0.5,
  ...overrides,
});

describe('PositionManager', () => {
  let pm: PositionManager;

  beforeEach(() => { pm = new PositionManager(); });

  it('adds and retrieves positions', () => {
    pm.addPosition(makePosition());
    expect(pm.getOpenPositions()).toHaveLength(1);
  });

  it('removes positions', () => {
    pm.addPosition(makePosition());
    pm.removePosition('p1');
    expect(pm.getOpenPositions()).toHaveLength(0);
  });

  it('updates price and high water mark', () => {
    pm.addPosition(makePosition());
    pm.updatePrice('p1', 0.7);
    const pos = pm.getPosition('p1')!;
    expect(pos.currentPrice).toBe(0.7);
    expect(pos.highWaterMark).toBeGreaterThan(0);
  });

  it('triggers hard stop on large loss', () => {
    pm.addPosition(makePosition({ entryPrice: 0.5, currentPrice: 0.5 }));
    pm.updatePrice('p1', 0.1); // massive loss
    const exits = pm.checkExits();
    expect(exits.some(e => e.reason === 'hard_stop')).toBe(true);
  });

  it('triggers max hold time', () => {
    pm.addPosition(makePosition({ enteredAt: Date.now() - 20 * 60 * 1000 })); // 20 min ago
    const exits = pm.checkExits();
    expect(exits.some(e => e.reason === 'max_hold_time')).toBe(true);
  });

  it('no exit for fresh healthy position', () => {
    pm.addPosition(makePosition());
    const exits = pm.checkExits();
    expect(exits).toHaveLength(0);
  });

  it('triggers trailing stop when PnL drops from high', () => {
    const pos = makePosition({ entryPrice: 0.5 });
    pm.addPosition(pos);
    pm.updatePrice('p1', 0.8); // up a lot, sets HWM
    pm.updatePrice('p1', 0.52); // drops back
    const exits = pm.checkExits();
    expect(exits.some(e => e.reason === 'trailing_stop')).toBe(true);
  });
});
