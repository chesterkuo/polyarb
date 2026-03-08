/**
 * Market-anchored win probability model.
 *
 * Uses the market price as a pre-game baseline (team strength proxy) and only
 * finds edges from in-game score shifts. At 0-0 the model returns the market
 * price, so there is zero phantom edge. As scoring happens, the logistic
 * model shift creates a real, score-driven edge.
 *
 * baseline  = first observed market YES price (away team probability, e.g. 0.40)
 * modelNow  = logistic(currentScore)  — returns HOME team win prob
 * modelZero = logistic(0-0 start)     — returns HOME team win prob
 * shift     = modelNow - modelZero    — positive when home leads
 * adjusted  = clamp(baseline - shift * SHIFT_SCALE, 0.02, 0.98)
 *
 * Note: shift is SUBTRACTED because marketPrice represents the AWAY team
 * (Kalshi YES = first team = visiting team). When home leads (positive shift),
 * the away team's probability should decrease.
 */

import type { Signal, Sport, SportGame, Market } from '../types';
import { calcNbaWinProb, calcNcaabWinProb } from './wp-models/nba-wp';
import { calcNhlWinProb } from './wp-models/nhl-wp';

const SHIFT_SCALE = 1.0;

/** When market is far from 50/50 it encodes team quality our model can't see. Dampen shift proportionally. */
const MIN_DAMP_FACTOR = 0.2;

/** Model output can never diverge more than this many pp from market price. */
const MAX_DIVERGENCE = 0.10;

/** ESPN divergence threshold — dampen ESPN if it differs from market by more than this. */
const ESPN_DIVERGENCE_THRESHOLD = 0.25;

/**
 * Minimum minutes elapsed before the model will shift from market price.
 * Early-game leads (e.g. 2-point lead in Q1) are noise — the model should
 * not generate edges until enough game has been played.
 */
const MIN_ELAPSED: Record<string, number> = {
  nba: 15,    // past mid-Q2 (~33 min remaining of 48)
  ncaab: 12,  // past mid-H1 (~28 min remaining of 40)
  nhl: 12,    // past mid-P1 (~48 min remaining of 60)
};

// ─── Futures filter (comprehensive, matches market-scout.ts + new entries) ──
export const FUTURES_KEYWORDS = [
  'finals', 'championship', 'playoffs', 'make the', 'win the', 'mvp',
  'award', 'season', 'conference', 'tournament', 'best record', 'worst record',
  'first pick', 'draft', 'regular season', 'over/under wins',
  'seed', 'number 1', 'stanley cup', 'super bowl', 'all-star',
  'sweet sixteen', 'elite eight', 'final four',
];

export function isFuturesMarket(question: string): boolean {
  const q = question.toLowerCase();
  return FUTURES_KEYWORDS.some(kw => q.includes(kw));
}

/**
 * Check that a market question looks like a head-to-head game market
 * (contains "at" or "vs"/"v." pattern separating two teams).
 * This prevents futures like "Will North Carolina be a #1 seed" from
 * matching a Carolina Hurricanes NHL game.
 */
export function isGameMarket(question: string): boolean {
  const q = question.toLowerCase();
  // Match patterns like "Team A vs Team B", "Team A v. Team B", "Team A at Team B", "Team A @ Team B"
  return /\b(at|vs\.?|v\.)\b/.test(q) || q.includes(' @ ');
}

/** Calculate total minutes left in the game for elapsed-time check. */
function calcMinutesLeft(game: SportGame): number {
  const clock = game.clock || '0:00';
  const mins = clock.includes(':')
    ? parseInt(clock.split(':')[0]) + parseInt(clock.split(':')[1]) / 60
    : parseFloat(clock) / 60;
  const clockMins = isNaN(mins) ? 0 : mins;

  switch (game.sport) {
    case 'nba':
      return clockMins + Math.max(0, 4 - game.period) * 12;
    case 'ncaab':
      return clockMins + Math.max(0, 2 - game.period) * 20;
    case 'nhl':
      return clockMins + Math.max(0, 3 - game.period) * 20;
    default:
      return clockMins;
  }
}

/** Get the logistic-model probability at 0-0 start for a given sport. */
function zeroZeroProb(sport: Sport): number {
  switch (sport) {
    case 'ncaab':
      return calcNcaabWinProb({ scoreDiff: 0, half: 1, timeLeft: '20:00' }, true);
    case 'nhl':
      return calcNhlWinProb({ scoreDiff: 0, period: 1, timeLeft: '20:00' }, true);
    default: // nba and others
      return calcNbaWinProb({ scoreDiff: 0, period: 1, timeLeft: '12:00' }, true);
  }
}

/** Get the logistic-model probability for the current game state. */
function currentModelProb(game: SportGame): number {
  const diff = game.homeTeam.score - game.awayTeam.score;
  switch (game.sport) {
    case 'ncaab':
      return calcNcaabWinProb({ scoreDiff: diff, half: game.period <= 1 ? 1 : 2, timeLeft: game.clock || '20:00' }, true);
    case 'nhl':
      return calcNhlWinProb({ scoreDiff: diff, period: game.period, timeLeft: game.clock || '20:00' }, true);
    default:
      return calcNbaWinProb({ scoreDiff: diff, period: game.period, timeLeft: game.clock || '12:00' }, true);
  }
}

/**
 * Compute a market-anchored signal.
 *
 * @param game       Current game state with live scores
 * @param marketPrice  YES price from the market (0-1) = away team probability, used as baseline
 * @param espnSignal Optional ESPN predictor signal
 * @returns Signal with anchored trueProb
 */
export function computeAnchoredSignal(
  game: SportGame,
  marketPrice: number,
  espnSignal: Signal | null,
): Signal {
  // Check if enough game time has elapsed for the model to be reliable
  const totalMinutes = game.sport === 'nba' ? 48 : game.sport === 'ncaab' ? 40 : 60;
  const minutesLeft = calcMinutesLeft(game);
  const elapsed = totalMinutes - minutesLeft;
  const minRequired = MIN_ELAPSED[game.sport] ?? 12;

  // Too early — return market price (zero edge)
  if (elapsed < minRequired) {
    const sourcePrefix = game.sport === 'ncaab' ? 'ncaab' : game.sport === 'nhl' ? 'nhl' : 'nba';
    return {
      trueProb: marketPrice,
      confidence: 0.30,
      source: `${sourcePrefix}-too-early`,
      timestamp: Date.now(),
    };
  }

  const modelZero = zeroZeroProb(game.sport);
  const modelNow = currentModelProb(game);
  const rawShift = modelNow - modelZero;

  // Dampen shift when market is far from 50/50 (encodes team quality we can't see)
  const confidence = Math.abs(marketPrice - 0.5) * 2;  // 0 at 50/50, 1 at extremes
  const dampFactor = Math.max(MIN_DAMP_FACTOR, 1.0 - confidence);
  const dampenedShift = rawShift * SHIFT_SCALE * dampFactor;
  const rawAnchored = marketPrice - dampenedShift;

  // Cap: model can never diverge more than MAX_DIVERGENCE from market price
  const capped = Math.max(marketPrice - MAX_DIVERGENCE, Math.min(marketPrice + MAX_DIVERGENCE, rawAnchored));
  const anchored = Math.max(0.02, Math.min(0.98, capped));

  // If ESPN predictor is available, use it but dampen if it diverges too much from market
  if (espnSignal) {
    const divergence = Math.abs(espnSignal.trueProb - marketPrice);
    if (divergence <= ESPN_DIVERGENCE_THRESHOLD) {
      return espnSignal;
    }
    // Blend ESPN toward market: move ESPN 50% toward the anchored value
    const blended = (espnSignal.trueProb + anchored) / 2;
    return {
      trueProb: Math.max(0.02, Math.min(0.98, blended)),
      confidence: espnSignal.confidence * 0.8,
      source: `espn-dampened`,
      timestamp: Date.now(),
    };
  }

  const sourcePrefix = game.sport === 'ncaab' ? 'ncaab' : game.sport === 'nhl' ? 'nhl' : 'nba';
  return {
    trueProb: anchored,
    confidence: 0.70,
    source: `${sourcePrefix}-anchored`,
    timestamp: Date.now(),
  };
}
