import { describe, it, expect, mock, afterEach } from 'bun:test';
import { NbaLiveClient } from '../../../src/data/nba/balldontlie';

const originalFetch = globalThis.fetch;

describe('NbaLiveClient', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const mockGame = (overrides: Record<string, any> = {}) => ({
    id: 101, status: 'In Progress', period: 3, time: '5:30',
    home_team_score: 78, visitor_team_score: 72,
    home_team: { abbreviation: 'LAL' },
    visitor_team: { abbreviation: 'BOS' },
    ...overrides,
  });

  it('getLiveGames parses and filters correctly', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({
        data: [
          mockGame(),
          mockGame({ id: 102, status: 'Final', period: 4 }),
          mockGame({ id: 103, status: 'Scheduled', period: 0 }),
        ],
      })))
    ) as any;

    const client = new NbaLiveClient();
    const games = await client.getLiveGames();
    expect(games).toHaveLength(1);
    expect(games[0].id).toBe(101);
    expect(games[0].home_team.abbreviation).toBe('LAL');
  });

  it('filters out Final games', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({
        data: [mockGame({ status: 'Final', period: 4 })],
      })))
    ) as any;

    const client = new NbaLiveClient();
    const games = await client.getLiveGames();
    expect(games).toHaveLength(0);
  });

  it('getSignal returns null for unknown game', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ data: [mockGame()] })))
    ) as any;

    const client = new NbaLiveClient();
    const signal = await client.getSignal('999');
    expect(signal).toBeNull();
  });

  it('getSignal returns valid signal for matching game', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ data: [mockGame()] })))
    ) as any;

    const client = new NbaLiveClient();
    const signal = await client.getSignal('101');
    expect(signal).not.toBeNull();
    expect(signal!.source).toBe('balldontlie-live');
    expect(signal!.confidence).toBe(0.70);
    expect(signal!.trueProb).toBeGreaterThan(0);
    expect(signal!.trueProb).toBeLessThan(1);
  });
});
