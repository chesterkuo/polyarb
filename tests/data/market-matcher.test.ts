import { describe, it, expect } from 'bun:test';
import { MarketMatcher } from '../../src/data/market-matcher';
import type { Market, LiveMatch } from '../../src/types';

const teamNames = {
  lol: {
    'T1': ['T1', 'SKT', 'SK Telecom'],
    'Gen.G': ['Gen.G', 'GenG'],
  },
  dota2: {
    'Team Spirit': ['Team Spirit', 'Spirit'],
  },
  cs2: {
    'Natus Vincere': ['Natus Vincere', 'NAVI', 'NaVi'],
    'FaZe Clan': ['FaZe Clan', 'FaZe'],
  },
  nba: {
    'LAL': ['Lakers', 'Los Angeles Lakers'],
    'BOS': ['Celtics', 'Boston Celtics'],
  },
  ncaab: {
    'DUKE': ['Duke', 'Duke Blue Devils'],
    'UNC': ['North Carolina', 'UNC', 'Tar Heels'],
  },
  nhl: {
    'BOS': ['Bruins', 'Boston Bruins'],
    'TOR': ['Maple Leafs', 'Toronto Maple Leafs', 'Leafs'],
  },
};

function makeMarket(overrides: Partial<Market> = {}): Market {
  return {
    id: 'mkt-1', conditionId: 'cond-1',
    question: 'Will T1 beat Gen.G in LoL LCK?',
    yesTokenId: 'yes', noTokenId: 'no',
    yesPrice: 0.6, noPrice: 0.4,
    negRisk: false, tickSize: 0.01,
    ...overrides,
  };
}

function makeMatch(overrides: Partial<LiveMatch> = {}): LiveMatch {
  return {
    id: 'match-1', game: 'lol',
    team1: 'T1', team2: 'Gen.G',
    status: 'running',
    ...overrides,
  };
}

describe('MarketMatcher', () => {
  it('matches market to live match by team names', () => {
    const matcher = new MarketMatcher(teamNames);
    const result = matcher.match(
      makeMarket({ question: 'Will T1 beat Gen.G in LoL LCK?' }),
      [makeMatch()],
    );
    expect(result).toBe('match-1');
  });

  it('detects LoL sport from question', () => {
    const matcher = new MarketMatcher(teamNames);
    const result = matcher.match(
      makeMarket({ question: 'Will T1 beat Gen.G in lol?' }),
      [makeMatch()],
    );
    expect(result).toBe('match-1');
  });

  it('detects CS2 sport from question', () => {
    const matcher = new MarketMatcher(teamNames);
    const result = matcher.match(
      makeMarket({ question: 'Will Natus Vincere beat FaZe Clan in cs2?' }),
      [makeMatch({ id: 'cs-match', game: 'cs2', team1: 'NAVI', team2: 'FaZe' })],
    );
    expect(result).toBe('cs-match');
  });

  it('returns null when no match found', () => {
    const matcher = new MarketMatcher(teamNames);
    const result = matcher.match(
      makeMarket({ question: 'Will team X beat team Y in lol?' }),
      [makeMatch()],
    );
    expect(result).toBeNull();
  });

  it('returns null for unknown sport', () => {
    const matcher = new MarketMatcher(teamNames);
    const result = matcher.match(
      makeMarket({ question: 'Will someone win a chess match?' }),
      [makeMatch()],
    );
    expect(result).toBeNull();
  });

  it('uses cache on second call', () => {
    const matcher = new MarketMatcher(teamNames);
    const market = makeMarket({ question: 'Will T1 beat Gen.G in lol?' });
    const matches = [makeMatch()];
    const result1 = matcher.match(market, matches);
    const result2 = matcher.match(market, []);
    expect(result1).toBe('match-1');
    expect(result2).toBe('match-1');
  });

  it('uses overrides when provided', () => {
    const matcher = new MarketMatcher(teamNames, { 'mkt-1': 'override-match' });
    const result = matcher.match(makeMarket(), []);
    expect(result).toBe('override-match');
  });

  it('normalizes team names using aliases', () => {
    const matcher = new MarketMatcher(teamNames);
    const result = matcher.match(
      makeMarket({ question: 'Will Natus Vincere beat FaZe Clan in cs2?' }),
      [makeMatch({ id: 'cs-match', game: 'cs2', team1: 'NaVi', team2: 'FaZe' })],
    );
    expect(result).toBe('cs-match');
  });

  it('detects NCAAB sport from question', () => {
    const matcher = new MarketMatcher(teamNames);
    const result = matcher.match(
      makeMarket({ question: 'Will DUKE beat UNC in NCAA tournament?' }),
      [makeMatch({ id: 'ncaa-match', game: undefined as any, team1: 'Duke', team2: 'UNC' })],
    );
    expect(result).toBe('ncaa-match');
  });

  it('detects NHL sport from question', () => {
    const matcher = new MarketMatcher(teamNames);
    const result = matcher.match(
      makeMarket({ question: 'Will BOS beat TOR in NHL?' }),
      [makeMatch({ id: 'nhl-match', game: undefined as any, team1: 'Bruins', team2: 'Leafs' })],
    );
    expect(result).toBe('nhl-match');
  });

  it('uses market.sport when set', () => {
    const matcher = new MarketMatcher(teamNames);
    const result = matcher.match(
      makeMarket({ question: 'Will BOS beat TOR?', sport: 'nhl' }),
      [makeMatch({ id: 'nhl-match', game: undefined as any, team1: 'Bruins', team2: 'Leafs' })],
    );
    expect(result).toBe('nhl-match');
  });
});
