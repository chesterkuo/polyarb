import { describe, it, expect } from 'bun:test';
import { calcNhlWinProb, type NhlGameState } from '../../src/signals/wp-models/nhl-wp';

describe('calcNhlWinProb', () => {
  it('returns ~0.5 for tied game at start', () => {
    const state: NhlGameState = { scoreDiff: 0, period: 1, timeLeft: '20:00' };
    const prob = calcNhlWinProb(state, true);
    expect(prob).toBeGreaterThan(0.5);
    expect(prob).toBeLessThan(0.65);
  });

  it('returns high prob for home team with lead late', () => {
    const state: NhlGameState = { scoreDiff: 3, period: 3, timeLeft: '2:00' };
    expect(calcNhlWinProb(state, true)).toBeGreaterThan(0.9);
  });

  it('returns low prob when trailing late', () => {
    const state: NhlGameState = { scoreDiff: -2, period: 3, timeLeft: '2:00' };
    expect(calcNhlWinProb(state, true)).toBeLessThan(0.20);
  });

  it('is bounded between 0.02 and 0.98', () => {
    const extreme: NhlGameState = { scoreDiff: 5, period: 3, timeLeft: '0:30' };
    expect(calcNhlWinProb(extreme, true)).toBeLessThanOrEqual(0.98);
    expect(calcNhlWinProb(extreme, false)).toBeGreaterThanOrEqual(0.02);
  });

  it('score matters more with less time', () => {
    const early: NhlGameState = { scoreDiff: 1, period: 1, timeLeft: '10:00' };
    const late: NhlGameState = { scoreDiff: 1, period: 3, timeLeft: '2:00' };
    expect(calcNhlWinProb(late, true)).toBeGreaterThan(calcNhlWinProb(early, true));
  });

  it('power play increases probability', () => {
    const base: NhlGameState = { scoreDiff: 0, period: 2, timeLeft: '10:00' };
    const withPP: NhlGameState = { ...base, homePowerPlay: true };
    expect(calcNhlWinProb(withPP, true)).toBeGreaterThan(calcNhlWinProb(base, true));
  });

  it('opposing power play decreases probability', () => {
    const base: NhlGameState = { scoreDiff: 0, period: 2, timeLeft: '10:00' };
    const withPP: NhlGameState = { ...base, awayPowerPlay: true };
    expect(calcNhlWinProb(withPP, true)).toBeLessThan(calcNhlWinProb(base, true));
  });
});
