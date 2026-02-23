import type { GameFrame, GameEvent, TeamFrame } from '../../types';

function diffTeam(prev: TeamFrame, curr: TeamFrame, team: 'team1' | 'team2', timestamp: number): GameEvent[] {
  const events: GameEvent[] = [];
  const check = (field: 'dragons' | 'barons' | 'roshans', type: GameEvent['type']) => {
    const delta = (curr[field] ?? 0) - (prev[field] ?? 0);
    for (let i = 0; i < delta; i++) events.push({ type, team, timestamp });
  };
  check('dragons', 'dragon_kill');
  check('barons', 'baron_kill');
  check('roshans', 'roshan_kill');

  const towers = curr.towers - prev.towers;
  for (let i = 0; i < towers; i++) events.push({ type: 'tower_kill', team, timestamp });

  const inhibs = curr.inhibitors - prev.inhibitors;
  for (let i = 0; i < inhibs; i++) events.push({ type: 'inhibitor_kill', team, timestamp });

  const scoreChange = (curr.score ?? 0) - (prev.score ?? 0);
  for (let i = 0; i < scoreChange; i++) events.push({ type: 'round_win', team, timestamp });

  return events;
}

export function diffFrames(prev: GameFrame, curr: GameFrame): GameEvent[] {
  const ts = curr.timestamp;
  return [
    ...diffTeam(prev.teams[0], curr.teams[0], 'team1', ts),
    ...diffTeam(prev.teams[1], curr.teams[1], 'team2', ts),
  ];
}
