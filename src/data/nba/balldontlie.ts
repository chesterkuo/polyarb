import type { Signal } from '../../types';
import { calcNbaWinProb } from '../../signals/wp-models/nba-wp';
import { CONFIG } from '../../config';
import { fetchWithRetry } from '../../utils/fetch-retry';

interface BdlGame {
  id: number; status: string; period: number; time: string;
  home_team_score: number; visitor_team_score: number;
  home_team: { abbreviation: string };
  visitor_team: { abbreviation: string };
}

export class NbaLiveClient {
  private base = 'https://api.balldontlie.io/v2';
  private headers: HeadersInit;

  constructor() { this.headers = { Authorization: CONFIG.bdlApiKey }; }

  async getLiveGames(): Promise<BdlGame[]> {
    const today = new Date().toISOString().split('T')[0];
    const res = await fetchWithRetry(`${this.base}/games?dates[]=${today}&per_page=15`, { headers: this.headers });
    const { data } = (await res.json()) as { data: BdlGame[] };
    return data.filter(g => g.period > 0 && g.status !== 'Final');
  }

  async getSignal(externalGameId: string): Promise<Signal | null> {
    const games = await this.getLiveGames();
    const game = games.find(g => String(g.id) === externalGameId);
    if (!game) return null;
    const prob = calcNbaWinProb({
      scoreDiff: game.home_team_score - game.visitor_team_score,
      period: game.period,
      timeLeft: game.time || '12:00',
    }, true);
    return { trueProb: prob, confidence: 0.70, source: 'balldontlie-live', timestamp: Date.now() };
  }
}
