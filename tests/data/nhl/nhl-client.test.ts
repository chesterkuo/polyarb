import { describe, it, expect, mock, afterEach } from 'bun:test';
import { NhlClient } from '../../../src/data/nhl/nhl-client';
import type { NhlPlay } from '../../../src/data/nhl/nhl-client';

const originalFetch = globalThis.fetch;

describe('NhlClient', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const mockSchedule = (games: any[] = []) => ({
    gameWeek: [{ games }],
  });

  const mockGame = (overrides: Record<string, any> = {}) => ({
    id: 2024020001,
    gameState: 'LIVE',
    period: 2,
    clock: { timeRemaining: '14:30' },
    homeTeam: { abbrev: 'BOS', name: { default: 'Boston Bruins' }, score: 2 },
    awayTeam: { abbrev: 'TOR', name: { default: 'Toronto Maple Leafs' }, score: 1 },
    ...overrides,
  });

  it('getLiveGames returns live games', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(mockSchedule([mockGame()]))))
    ) as any;

    const client = new NhlClient();
    const games = await client.getLiveGames();
    expect(games).toHaveLength(1);
    expect(games[0].id).toBe('2024020001');
    expect(games[0].sport).toBe('nhl');
    expect(games[0].homeTeam.abbreviation).toBe('BOS');
    expect(games[0].homeTeam.score).toBe(2);
    expect(games[0].awayTeam.abbreviation).toBe('TOR');
    expect(games[0].period).toBe(2);
    expect(games[0].clock).toBe('14:30');
  });

  it('filters out non-live games', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(mockSchedule([
        mockGame(),
        mockGame({ id: 2, gameState: 'FUT' }),
        mockGame({ id: 3, gameState: 'FINAL' }),
      ]))))
    ) as any;

    const client = new NhlClient();
    const games = await client.getLiveGames();
    expect(games).toHaveLength(1);
  });

  it('includes CRIT state games', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(mockSchedule([
        mockGame({ gameState: 'CRIT' }),
      ]))))
    ) as any;

    const client = new NhlClient();
    const games = await client.getLiveGames();
    expect(games).toHaveLength(1);
  });

  it('returns empty array on invalid response', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('not json', { status: 500 }))
    ) as any;
    const client = new NhlClient();
    const games = await client.getLiveGames();
    expect(games).toHaveLength(0);
  });

  it('detectPowerPlay detects home power play', () => {
    const client = new NhlClient();
    const plays: NhlPlay[] = [
      { typeDescKey: 'penalty', periodDescriptor: { number: 2 }, details: { eventOwnerTeamId: 20 } },
    ];
    const result = client.detectPowerPlay(plays, 10);
    expect(result.homePP).toBe(true);
    expect(result.awayPP).toBe(false);
  });

  it('detectPowerPlay detects away power play', () => {
    const client = new NhlClient();
    const plays: NhlPlay[] = [
      { typeDescKey: 'penalty', periodDescriptor: { number: 2 }, details: { eventOwnerTeamId: 10 } },
    ];
    const result = client.detectPowerPlay(plays, 10);
    expect(result.homePP).toBe(false);
    expect(result.awayPP).toBe(true);
  });

  it('detectPowerPlay returns no PP when penalties are even', () => {
    const client = new NhlClient();
    const plays: NhlPlay[] = [
      { typeDescKey: 'penalty', periodDescriptor: { number: 2 }, details: { eventOwnerTeamId: 10 } },
      { typeDescKey: 'penalty', periodDescriptor: { number: 2 }, details: { eventOwnerTeamId: 20 } },
    ];
    const result = client.detectPowerPlay(plays, 10);
    expect(result.homePP).toBe(false);
    expect(result.awayPP).toBe(false);
  });
});
