import type { Market, LiveMatch, Sport } from '../types';

interface TeamDictionary { [canonical: string]: string[] }
interface TeamNames {
  lol: TeamDictionary; dota2: TeamDictionary; cs2: TeamDictionary;
  nba: TeamDictionary; ncaab: TeamDictionary; nhl: TeamDictionary;
}

export class MarketMatcher {
  private cache = new Map<string, string>();
  private teamNames: TeamNames;
  private overrides: Record<string, string>;

  constructor(teamNames: TeamNames, overrides: Record<string, string> = {}) {
    this.teamNames = teamNames;
    this.overrides = overrides;
  }

  match(market: Market, liveMatches: LiveMatch[]): string | null {
    if (this.overrides[market.id]) return this.overrides[market.id];
    if (this.cache.has(market.id)) return this.cache.get(market.id)!;

    const q = market.question.toLowerCase();
    const sport = market.sport ?? this.detectSport(q);
    if (!sport) return null;

    for (const match of liveMatches) {
      if (sport !== match.game && !(sport === 'nba' && match.game === undefined as any)
        && !(sport === 'ncaab' && match.game === undefined as any)
        && !(sport === 'nhl' && match.game === undefined as any)) continue;
      const t1 = this.normalizeTeam(match.team1, sport);
      const t2 = this.normalizeTeam(match.team2, sport);
      if (q.includes(t1.toLowerCase()) && q.includes(t2.toLowerCase())) {
        this.cache.set(market.id, match.id);
        return match.id;
      }
    }
    return null;
  }

  private detectSport(question: string): Sport | null {
    if (question.includes('lol') || question.includes('league of legends')) return 'lol';
    if (question.includes('dota') || question.includes('dota 2')) return 'dota2';
    if (question.includes('cs2') || question.includes('counter-strike') || question.includes('csgo')) return 'cs2';
    if (question.includes('ncaa') || question.includes('ncaab') || question.includes('march madness') || question.includes('college basketball')) return 'ncaab';
    if (question.includes('nhl') || question.includes('hockey')) return 'nhl';
    if (question.includes('nba') || question.includes('lakers') || question.includes('celtics')) return 'nba';
    return null;
  }

  private normalizeTeam(name: string, sport: Sport): string {
    const dict = this.teamNames[sport as keyof TeamNames];
    if (!dict) return name;
    for (const [canonical, aliases] of Object.entries(dict)) {
      if (aliases.some(a => a.toLowerCase() === name.toLowerCase())) return canonical;
    }
    return name;
  }
}
