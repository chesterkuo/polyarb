import { describe, it, expect } from 'bun:test';
import { diffFrames } from '../../../src/data/esports/frame-differ';
import type { GameFrame, TeamFrame } from '../../../src/types';

function makeTeam(overrides: Partial<TeamFrame> = {}): TeamFrame {
  return { name: 'Team', kills: 0, gold: 0, towers: 0, inhibitors: 0, dragons: 0, barons: 0, ...overrides };
}

function makeFrame(t1: Partial<TeamFrame> = {}, t2: Partial<TeamFrame> = {}, ts = 100): GameFrame {
  return { timestamp: ts, gameTimeSeconds: 0, teams: [makeTeam(t1), makeTeam(t2)] };
}

describe('diffFrames', () => {
  it('returns empty for identical frames', () => {
    const f = makeFrame();
    expect(diffFrames(f, f)).toEqual([]);
  });

  it('detects dragon kill', () => {
    const prev = makeFrame({ dragons: 0 });
    const curr = makeFrame({ dragons: 1 }, {}, 200);
    const events = diffFrames(prev, curr);
    expect(events).toEqual([{ type: 'dragon_kill', team: 'team1', timestamp: 200 }]);
  });

  it('detects baron kill', () => {
    const prev = makeFrame({ barons: 0 });
    const curr = makeFrame({ barons: 1 }, {}, 300);
    const events = diffFrames(prev, curr);
    expect(events).toEqual([{ type: 'baron_kill', team: 'team1', timestamp: 300 }]);
  });

  it('detects tower kill', () => {
    const prev = makeFrame({ towers: 2 });
    const curr = makeFrame({ towers: 3 }, {}, 400);
    const events = diffFrames(prev, curr);
    expect(events).toEqual([{ type: 'tower_kill', team: 'team1', timestamp: 400 }]);
  });

  it('detects inhibitor kill', () => {
    const prev = makeFrame({ inhibitors: 0 });
    const curr = makeFrame({ inhibitors: 1 }, {}, 500);
    const events = diffFrames(prev, curr);
    expect(events).toEqual([{ type: 'inhibitor_kill', team: 'team1', timestamp: 500 }]);
  });

  it('detects multiple events across teams', () => {
    const prev = makeFrame({ dragons: 1, towers: 3 }, { barons: 0, towers: 1 });
    const curr = makeFrame({ dragons: 2, towers: 4 }, { barons: 1, towers: 2 }, 600);
    const events = diffFrames(prev, curr);
    expect(events.length).toBe(4);
    expect(events.filter(e => e.team === 'team1').length).toBe(2);
    expect(events.filter(e => e.team === 'team2').length).toBe(2);
  });

  it('detects CS2 round win via score change', () => {
    const prev = makeFrame({ score: 5 }, { score: 3 });
    const curr = makeFrame({ score: 6 }, { score: 3 }, 700);
    const events = diffFrames(prev, curr);
    expect(events).toEqual([{ type: 'round_win', team: 'team1', timestamp: 700 }]);
  });
});
