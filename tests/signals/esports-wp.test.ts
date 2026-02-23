import { describe, it, expect } from 'bun:test';
import { bayesianUpdate, EVENT_LOG_ODDS, computeEsportsWinProb } from '../../src/signals/wp-models/esports-wp';
import type { GameEvent } from '../../src/types';

describe('bayesianUpdate', () => {
  it('updates 50% probability correctly for baron kill', () => {
    const result = bayesianUpdate(0.5, EVENT_LOG_ODDS.baron_kill);
    expect(result).toBeGreaterThan(0.65);
    expect(result).toBeLessThan(0.75);
  });

  it('never exceeds 0.999', () => {
    expect(bayesianUpdate(0.95, 10.0)).toBeLessThan(1.0);
  });

  it('never goes below 0.001', () => {
    expect(bayesianUpdate(0.05, -10.0)).toBeGreaterThan(0.0);
  });

  it('shifts less at extreme probabilities', () => {
    const shiftAt50 = bayesianUpdate(0.5, 0.85) - 0.5;
    const shiftAt80 = bayesianUpdate(0.8, 0.85) - 0.8;
    expect(shiftAt50).toBeGreaterThan(shiftAt80);
  });

  it('is symmetric around 0.5', () => {
    const up = bayesianUpdate(0.5, 0.5);
    const down = bayesianUpdate(0.5, -0.5);
    expect(up + down).toBeCloseTo(1.0, 5);
  });
});

describe('computeEsportsWinProb', () => {
  it('returns 0.5 for no events', () => {
    expect(computeEsportsWinProb([])).toBeCloseTo(0.5);
  });

  it('increases for team1 baron kill', () => {
    const events: GameEvent[] = [{ type: 'baron_kill', team: 'team1', timestamp: Date.now() }];
    expect(computeEsportsWinProb(events)).toBeGreaterThan(0.6);
  });

  it('decreases for team2 events', () => {
    const events: GameEvent[] = [{ type: 'inhibitor_kill', team: 'team2', timestamp: Date.now() }];
    expect(computeEsportsWinProb(events)).toBeLessThan(0.4);
  });

  it('handles game_end correctly', () => {
    const events: GameEvent[] = [{ type: 'game_end', team: 'team1', timestamp: Date.now() }];
    expect(computeEsportsWinProb(events)).toBeGreaterThan(0.999);
  });
});
