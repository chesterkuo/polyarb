import { describe, it, expect, mock, afterEach } from 'bun:test';
import { EspnClient } from '../../../src/data/espn/espn-client';

const originalFetch = globalThis.fetch;

describe('EspnClient', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const mockScoreboard = (events: any[] = []) => ({
    events,
  });

  const mockEvent = (overrides: Record<string, any> = {}) => ({
    id: '401650001',
    competitions: [{
      competitors: [
        {
          homeAway: 'home',
          team: { displayName: 'Los Angeles Lakers', abbreviation: 'LAL' },
          score: '78',
        },
        {
          homeAway: 'away',
          team: { displayName: 'Boston Celtics', abbreviation: 'BOS' },
          score: '72',
        },
      ],
      status: {
        type: { state: 'in', detail: '5:30 - 3rd Quarter' },
        period: 3,
        displayClock: '5:30',
      },
    }],
    ...overrides,
  });

  it('getLiveGames returns in-progress games', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(mockScoreboard([mockEvent()]))))
    ) as any;

    const client = new EspnClient();
    const games = await client.getLiveGames('nba');
    expect(games).toHaveLength(1);
    expect(games[0].id).toBe('401650001');
    expect(games[0].sport).toBe('nba');
    expect(games[0].homeTeam.abbreviation).toBe('LAL');
    expect(games[0].homeTeam.score).toBe(78);
    expect(games[0].awayTeam.abbreviation).toBe('BOS');
    expect(games[0].awayTeam.score).toBe(72);
    expect(games[0].period).toBe(3);
    expect(games[0].clock).toBe('5:30');
    expect(games[0].status).toBe('in_progress');
  });

  it('filters out non-live games', async () => {
    const preGame = mockEvent({ id: '2' });
    preGame.competitions[0].status.type.state = 'pre';
    const postGame = mockEvent({ id: '3' });
    postGame.competitions[0].status.type.state = 'post';

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(mockScoreboard([
        mockEvent(),
        preGame,
        postGame,
      ]))))
    ) as any;

    const client = new EspnClient();
    const games = await client.getLiveGames('nba');
    expect(games).toHaveLength(1);
    expect(games[0].id).toBe('401650001');
  });

  it('returns empty array for unknown sport', async () => {
    const client = new EspnClient();
    const games = await client.getLiveGames('lol');
    expect(games).toHaveLength(0);
  });

  it('returns empty array on invalid response', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('not json', { status: 500 }))
    ) as any;
    const client = new EspnClient();
    const games = await client.getLiveGames('nba');
    expect(games).toHaveLength(0);
  });

  it('works for NHL sport path', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(mockScoreboard([mockEvent()]))))
    ) as any;

    const client = new EspnClient();
    const games = await client.getLiveGames('nhl');
    expect(games).toHaveLength(1);
    expect(games[0].sport).toBe('nhl');
  });

  it('works for NCAAB sport path', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(mockScoreboard([mockEvent()]))))
    ) as any;

    const client = new EspnClient();
    const games = await client.getLiveGames('ncaab');
    expect(games).toHaveLength(1);
    expect(games[0].sport).toBe('ncaab');
  });

  it('getPredictor returns signal for valid response', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({
        homeProjectedWinPercentage: 0.65,
        awayProjectedWinPercentage: 0.35,
      })))
    ) as any;

    const client = new EspnClient();
    const signal = await client.getPredictor('nba', '401650001');
    expect(signal).not.toBeNull();
    expect(signal!.trueProb).toBe(0.65);
    expect(signal!.confidence).toBe(0.80);
    expect(signal!.source).toBe('espn-predictor-nba');
  });

  it('getPredictor returns null on invalid response', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('not json', { status: 500 }))
    ) as any;
    const client = new EspnClient();
    const signal = await client.getPredictor('nba', '401650001');
    expect(signal).toBeNull();
  });
});
