import { describe, it, expect } from 'bun:test';
import { calcNbaWinProb, type GameState } from '../../src/signals/wp-models/nba-wp';

describe('calcNbaWinProb', () => {
  it('returns ~0.5 for tied game at start', () => {
    const state: GameState = { scoreDiff: 0, period: 1, timeLeft: '12:00' };
    const prob = calcNbaWinProb(state, true);
    expect(prob).toBeGreaterThan(0.5);
    expect(prob).toBeLessThan(0.65);
  });

  it('returns higher prob for home team with large lead', () => {
    const state: GameState = { scoreDiff: 20, period: 4, timeLeft: '5:00' };
    expect(calcNbaWinProb(state, true)).toBeGreaterThan(0.9);
  });

  it('returns low prob for home team when trailing big late', () => {
    const state: GameState = { scoreDiff: -15, period: 4, timeLeft: '2:00' };
    expect(calcNbaWinProb(state, true)).toBeLessThan(0.1);
  });

  it('is bounded between 0.02 and 0.98', () => {
    const extreme: GameState = { scoreDiff: 50, period: 4, timeLeft: '0:30' };
    expect(calcNbaWinProb(extreme, true)).toBeLessThanOrEqual(0.98);
    expect(calcNbaWinProb(extreme, false)).toBeGreaterThanOrEqual(0.02);
  });

  it('score matters more with less time', () => {
    const early: GameState = { scoreDiff: 10, period: 1, timeLeft: '6:00' };
    const late: GameState = { scoreDiff: 10, period: 4, timeLeft: '2:00' };
    expect(calcNbaWinProb(late, true)).toBeGreaterThan(calcNbaWinProb(early, true));
  });
});
