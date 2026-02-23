import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { PandaScoreClient } from '../../../src/data/esports/pandascore-client';

const originalFetch = globalThis.fetch;

describe('PandaScoreClient', () => {
  let client: PandaScoreClient;

  beforeEach(() => {
    client = new PandaScoreClient('test-api-key');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('getLiveMatches parses response correctly', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify([
        {
          id: 12345, name: 'Match 1', status: 'running',
          opponents: [
            { opponent: { name: 'T1' } },
            { opponent: { name: 'Gen.G' } },
          ],
          league: { name: 'LCK' },
        },
      ])))
    ) as any;

    const matches = await client.getLiveMatches('lol');
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe('12345');
    expect(matches[0].game).toBe('lol');
    expect(matches[0].team1).toBe('T1');
    expect(matches[0].team2).toBe('Gen.G');
    expect(matches[0].status).toBe('running');
    expect(matches[0].league).toBe('LCK');
  });

  it('getLiveMatches returns empty array for no matches', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify([])))
    ) as any;

    const matches = await client.getLiveMatches('dota2');
    expect(matches).toEqual([]);
  });

  it('uses correct slug for CS2', async () => {
    let calledUrl = '';
    globalThis.fetch = mock((url: string) => {
      calledUrl = url;
      return Promise.resolve(new Response(JSON.stringify([])));
    }) as any;

    await client.getLiveMatches('cs2');
    expect(calledUrl).toContain('/csgo/matches/running');
  });
});
