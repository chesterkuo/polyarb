import { parseClockToMinutes } from './parse-clock';

export interface GameState {
  scoreDiff: number;
  period: number;
  timeLeft: string;
  isPlayoffs?: boolean;
}

export function calcNbaWinProb(state: GameState, forHome: boolean): number {
  const { scoreDiff, period, timeLeft, isPlayoffs = false } = state;
  const minutesLeft = parseClockToMinutes(timeLeft) + Math.max(0, 4 - period) * 12;
  const homeAdv = isPlayoffs ? 2.5 : 3.5;
  const adjustedDiff = forHome ? scoreDiff + homeAdv : -scoreDiff - homeAdv;
  const timeWeight = Math.sqrt(Math.max(minutesLeft, 0.1));
  const k = 0.4 / timeWeight;
  const prob = 1 / (1 + Math.exp(-k * adjustedDiff));
  return Math.max(0.02, Math.min(0.98, prob));
}

export interface NcaabGameState {
  scoreDiff: number;   // home - away
  half: number;        // 1 or 2
  timeLeft: string;    // "MM:SS"
}

export function calcNcaabWinProb(state: NcaabGameState, forHome: boolean): number {
  const { scoreDiff, half, timeLeft } = state;
  // 2 halves x 20 min
  const minutesLeft = parseClockToMinutes(timeLeft) + Math.max(0, 2 - half) * 20;
  const homeAdv = 3.0; // NCAAB home advantage ~3 pts
  const adjustedDiff = forHome ? scoreDiff + homeAdv : -scoreDiff - homeAdv;
  const timeWeight = Math.sqrt(Math.max(minutesLeft, 0.1));
  const k = 0.4 / timeWeight;
  const prob = 1 / (1 + Math.exp(-k * adjustedDiff));
  return Math.max(0.02, Math.min(0.98, prob));
}
