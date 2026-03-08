import { test, expect, describe } from 'bun:test';
import {
  computeAnchoredSignal,
  isFuturesMarket,
  isGameMarket,
  FUTURES_KEYWORDS,
} from '../../src/signals/market-anchored-wp';
import type { SportGame, Signal } from '../../src/types';

// ─── Helper: build a game at 0-0 start ─────────────────────────────────────
function makeGame(sport: 'nba' | 'ncaab' | 'nhl', homeScore = 0, awayScore = 0, period = 1, clock?: string): SportGame {
  const defaultClock = sport === 'nhl' ? '20:00' : sport === 'ncaab' ? '20:00' : '12:00';
  return {
    id: 'test-1',
    sport,
    homeTeam: { name: 'Home Team', abbreviation: 'HME', score: homeScore },
    awayTeam: { name: 'Away Team', abbreviation: 'AWY', score: awayScore },
    period,
    clock: clock ?? defaultClock,
    status: 'in_progress',
  };
}

// ─── Anchored WP model ─────────────────────────────────────────────────────
describe('computeAnchoredSignal', () => {
  test('returns market price (too early) at 0-0 start for NBA', () => {
    const game = makeGame('nba', 0, 0, 1, '12:00');
    const signal = computeAnchoredSignal(game, 0.40, null);
    // Game just started — too early filter returns market price (zero edge)
    expect(signal.trueProb).toBe(0.40);
    expect(signal.source).toBe('nba-too-early');
  });

  test('returns market price (too early) at 0-0 start for NHL', () => {
    const game = makeGame('nhl', 0, 0, 1, '20:00');
    const signal = computeAnchoredSignal(game, 0.55, null);
    expect(signal.trueProb).toBe(0.55);
    expect(signal.source).toBe('nhl-too-early');
  });

  test('returns market price (too early) at 0-0 start for NCAAB', () => {
    const game = makeGame('ncaab', 0, 0, 1, '20:00');
    const signal = computeAnchoredSignal(game, 0.65, null);
    expect(signal.trueProb).toBe(0.65);
    expect(signal.source).toBe('ncaab-too-early');
  });

  test('returns anchored signal after enough game time elapsed', () => {
    // NBA Q2 6:00 = 18 min elapsed (> 15 min required)
    const game = makeGame('nba', 5, 5, 2, '6:00');
    const signal = computeAnchoredSignal(game, 0.50, null);
    expect(signal.source).toBe('nba-anchored');
    // At tied score, should be near market price
    expect(signal.trueProb).toBeCloseTo(0.50, 1);
  });

  test('shifts DOWN (away less likely) when home team leads', () => {
    const game = makeGame('nba', 15, 0, 2, '6:00');
    const signal = computeAnchoredSignal(game, 0.40, null);
    // Home up 15 → away team (YES) less likely → trueProb below baseline
    expect(signal.trueProb).toBeLessThan(0.40);
    expect(signal.source).toBe('nba-anchored');
  });

  test('shifts UP (away more likely) when home team trails', () => {
    const game = makeGame('nba', 0, 15, 2, '6:00');
    const signal = computeAnchoredSignal(game, 0.60, null);
    // Home down 15 → away team (YES) more likely → trueProb above baseline
    expect(signal.trueProb).toBeGreaterThan(0.60);
  });

  test('extreme blowout capped at max divergence from market', () => {
    // Home up 50 in Q4 with 1 min left — model wants to shift a lot but cap limits to ±10pp
    const game = makeGame('nba', 120, 70, 4, '1:00');
    const signal = computeAnchoredSignal(game, 0.50, null);
    // Capped at market - 0.10 = 0.40
    expect(signal.trueProb).toBe(0.40);
    // Away team up big → capped at market + 0.10 = 0.60
    const game2 = makeGame('nba', 70, 120, 4, '1:00');
    const signal2 = computeAnchoredSignal(game2, 0.50, null);
    expect(signal2.trueProb).toBe(0.60);
  });

  test('clamps at 0.02/0.98 when market price is extreme', () => {
    // Blowout + low market price → should hit 0.02 floor
    const game = makeGame('nba', 120, 70, 4, '1:00');
    const signal = computeAnchoredSignal(game, 0.10, null);
    expect(signal.trueProb).toBe(0.02);
    // Blowout reverse + high market price → should hit 0.98 ceiling
    const game2 = makeGame('nba', 70, 120, 4, '1:00');
    const signal2 = computeAnchoredSignal(game2, 0.90, null);
    expect(signal2.trueProb).toBe(0.98);
  });

  test('uses ESPN signal directly when divergence is small', () => {
    const game = makeGame('nba', 10, 5, 2, '8:00');
    const espn: Signal = { trueProb: 0.60, confidence: 0.85, source: 'espn-predictor', timestamp: Date.now() };
    const signal = computeAnchoredSignal(game, 0.55, espn);
    // ESPN is only 0.05 away from market, should use ESPN directly
    expect(signal.trueProb).toBe(0.60);
    expect(signal.source).toBe('espn-predictor');
  });

  test('dampens ESPN signal when divergence is large', () => {
    const game = makeGame('nba', 10, 5, 2, '8:00');
    const espn: Signal = { trueProb: 0.90, confidence: 0.85, source: 'espn-predictor', timestamp: Date.now() };
    const signal = computeAnchoredSignal(game, 0.40, espn);
    // ESPN is 0.50 away from market — should be dampened
    expect(signal.source).toBe('espn-dampened');
    expect(signal.trueProb).toBeLessThan(0.90);
    expect(signal.trueProb).toBeGreaterThan(0.40);
    expect(signal.confidence).toBeLessThan(0.85);
  });

  test('NHL shift is meaningful with 2-goal lead', () => {
    const game = makeGame('nhl', 3, 1, 2, '10:00');
    const signal = computeAnchoredSignal(game, 0.50, null);
    // Home up 2 goals mid-game → away team less likely → trueProb below 0.50
    // Capped at max divergence (0.40 minimum from 0.50 market)
    expect(signal.trueProb).toBeLessThanOrEqual(0.40);
  });

  test('dampens shift for underdog-with-lead (Georgetown scenario)', () => {
    // Underdog (market=0.69) has a lead — the shift should be dampened
    // because market far from 50/50 encodes team quality
    const game = makeGame('ncaab', 20, 35, 2, '8:00'); // away (underdog) leading by 15
    const signal = computeAnchoredSignal(game, 0.69, null);
    // With dampening, the shift should be smaller than without
    // Max divergence cap: signal can't exceed market + 0.10 = 0.79
    expect(signal.trueProb).toBeLessThanOrEqual(0.79);
    expect(signal.trueProb).toBeGreaterThan(0.69); // away is leading, so prob should increase
  });

  test('preserves full shift when market is near 50/50', () => {
    // Even game (market=0.50) → dampFactor is 1.0, no dampening
    const game = makeGame('nba', 0, 15, 2, '6:00'); // away leading by 15
    const signal = computeAnchoredSignal(game, 0.50, null);
    // At 50/50 market, confidence=0, dampFactor=1.0 — full shift applied
    expect(signal.trueProb).toBeGreaterThan(0.55);
    expect(signal.source).toBe('nba-anchored');
  });

  test('max divergence cap enforced — never more than 10pp from market', () => {
    // Big lead with market price far from 50/50
    const game = makeGame('nba', 0, 30, 3, '6:00'); // away team blowout lead
    const signal = computeAnchoredSignal(game, 0.30, null);
    // Even though away is crushing, model can't go above market + 0.10 = 0.40
    expect(signal.trueProb).toBeLessThanOrEqual(0.40);
    expect(signal.trueProb).toBeGreaterThanOrEqual(0.20); // and not below market - 0.10
  });
});

// ─── Futures filter ─────────────────────────────────────────────────────────
describe('isFuturesMarket', () => {
  test('catches original keywords', () => {
    expect(isFuturesMarket('Will the Lakers win the NBA Finals?')).toBe(true);
    expect(isFuturesMarket('Will Boston make the playoffs?')).toBe(true);
    expect(isFuturesMarket('NBA MVP award winner')).toBe(true);
    expect(isFuturesMarket('Eastern Conference winner')).toBe(true);
  });

  test('catches new keywords: seed', () => {
    expect(isFuturesMarket('Will North Carolina be a #1 seed?')).toBe(true);
  });

  test('catches new keywords: stanley cup', () => {
    expect(isFuturesMarket('Will the Panthers win the Stanley Cup?')).toBe(true);
  });

  test('catches new keywords: super bowl', () => {
    expect(isFuturesMarket('Super Bowl winner 2026')).toBe(true);
  });

  test('catches new keywords: tournament', () => {
    expect(isFuturesMarket('March Madness Tournament bracket')).toBe(true);
  });

  test('catches new keywords: sweet sixteen, elite eight, final four', () => {
    expect(isFuturesMarket('Will Duke make the Sweet Sixteen?')).toBe(true);
    expect(isFuturesMarket('Elite Eight predictions')).toBe(true);
    expect(isFuturesMarket('Final Four contenders')).toBe(true);
  });

  test('catches new keywords: draft, first pick', () => {
    expect(isFuturesMarket('2026 NBA Draft first overall pick')).toBe(true);
    expect(isFuturesMarket('Who gets the first pick?')).toBe(true);
  });

  test('catches new keywords: best/worst record, regular season, over/under wins', () => {
    expect(isFuturesMarket('Which team will have the best record?')).toBe(true);
    expect(isFuturesMarket('Worst record in the league')).toBe(true);
    expect(isFuturesMarket('Regular season total')).toBe(true);
    expect(isFuturesMarket('Over/under wins for the season')).toBe(true);
  });

  test('catches new keywords: all-star, number 1', () => {
    expect(isFuturesMarket('NBA All-Star Game MVP')).toBe(true);
    expect(isFuturesMarket('Will they be the number 1 seed?')).toBe(true);
  });

  test('does NOT flag actual game markets', () => {
    expect(isFuturesMarket('Lakers vs Celtics - Who will win?')).toBe(false);
    expect(isFuturesMarket('OKC Thunder at Denver Nuggets')).toBe(false);
    expect(isFuturesMarket('Carolina Hurricanes vs Dallas Stars')).toBe(false);
  });

  test('has all expected keywords', () => {
    expect(FUTURES_KEYWORDS.length).toBeGreaterThanOrEqual(23);
    expect(FUTURES_KEYWORDS).toContain('seed');
    expect(FUTURES_KEYWORDS).toContain('stanley cup');
    expect(FUTURES_KEYWORDS).toContain('super bowl');
    expect(FUTURES_KEYWORDS).toContain('sweet sixteen');
    expect(FUTURES_KEYWORDS).toContain('elite eight');
    expect(FUTURES_KEYWORDS).toContain('final four');
    expect(FUTURES_KEYWORDS).toContain('tournament');
    expect(FUTURES_KEYWORDS).toContain('draft');
  });
});

// ─── Game market check ──────────────────────────────────────────────────────
describe('isGameMarket', () => {
  test('matches "at" pattern', () => {
    expect(isGameMarket('Oklahoma City Thunder at Denver Nuggets')).toBe(true);
  });

  test('matches "vs" pattern', () => {
    expect(isGameMarket('Lakers vs Celtics')).toBe(true);
  });

  test('matches "vs." pattern', () => {
    expect(isGameMarket('Lakers vs. Celtics')).toBe(true);
  });

  test('matches "@" pattern', () => {
    expect(isGameMarket('OKC @ DEN - Who wins?')).toBe(true);
  });

  test('rejects futures-style markets', () => {
    expect(isGameMarket('Will North Carolina be a #1 seed?')).toBe(false);
  });

  test('rejects markets without game pattern', () => {
    expect(isGameMarket('Will the Carolina Hurricanes win tonight?')).toBe(false);
  });
});
