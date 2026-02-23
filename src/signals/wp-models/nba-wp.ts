export interface GameState {
  scoreDiff: number;
  period: number;
  timeLeft: string;
  isPlayoffs?: boolean;
}

export function calcNbaWinProb(state: GameState, forHome: boolean): number {
  const { scoreDiff, period, timeLeft, isPlayoffs = false } = state;
  const [m, s] = timeLeft.split(':').map(Number);
  const minutesLeft = m + s / 60 + Math.max(0, 4 - period) * 12;
  const homeAdv = isPlayoffs ? 2.5 : 3.5;
  const adjustedDiff = forHome ? scoreDiff + homeAdv : -scoreDiff - homeAdv;
  const timeWeight = Math.sqrt(Math.max(minutesLeft, 0.1));
  const k = 0.4 / timeWeight;
  const prob = 1 / (1 + Math.exp(-k * adjustedDiff));
  return Math.max(0.02, Math.min(0.98, prob));
}
