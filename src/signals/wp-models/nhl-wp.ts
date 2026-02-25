export interface NhlGameState {
  scoreDiff: number;    // home - away
  period: number;       // 1-3 (or 4+ for OT)
  timeLeft: string;     // "MM:SS"
  homePowerPlay?: boolean;
  awayPowerPlay?: boolean;
}

import { parseClockToMinutes } from './parse-clock';

export function calcNhlWinProb(state: NhlGameState, forHome: boolean): number {
  const { scoreDiff, period, timeLeft, homePowerPlay = false, awayPowerPlay = false } = state;
  const minutesLeft = parseClockToMinutes(timeLeft) + Math.max(0, 3 - period) * 20;

  const homeAdv = 0.2; // ~0.2 goals home advantage in NHL
  const adjustedDiff = forHome ? scoreDiff + homeAdv : -scoreDiff - homeAdv;

  // Steeper k because goals are rarer than basketball points
  const timeWeight = Math.sqrt(Math.max(minutesLeft, 0.1));
  const k = 1.2 / timeWeight;
  let prob = 1 / (1 + Math.exp(-k * adjustedDiff));

  // Power play adjustment
  if (forHome && homePowerPlay) prob += 0.08;
  if (forHome && awayPowerPlay) prob -= 0.08;
  if (!forHome && awayPowerPlay) prob += 0.08;
  if (!forHome && homePowerPlay) prob -= 0.08;

  return Math.max(0.02, Math.min(0.98, prob));
}
