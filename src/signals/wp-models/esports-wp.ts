import type { GameEvent, GameEventType } from '../../types';

export const EVENT_LOG_ODDS: Record<GameEventType, number> = {
  dragon_kill:    0.25,
  baron_kill:     0.85,
  tower_kill:     0.35,
  inhibitor_kill: 1.5,
  roshan_kill:    0.85,
  barracks_kill:  1.5,
  round_win:      0.15,
  map_win:        1.2,
  game_end:       10.0,
};

export function bayesianUpdate(currentProb: number, impactLogOdds: number): number {
  const p = Math.max(0.001, Math.min(0.999, currentProb));
  const logOdds = Math.log(p / (1 - p));
  const updated = logOdds + impactLogOdds;
  return 1 / (1 + Math.exp(-updated));
}

export function computeEsportsWinProb(events: GameEvent[], startProb = 0.5): number {
  let prob = startProb;
  for (const event of events) {
    const impact = EVENT_LOG_ODDS[event.type] ?? 0;
    const direction = event.team === 'team1' ? 1 : -1;
    prob = bayesianUpdate(prob, impact * direction);
  }
  return prob;
}
