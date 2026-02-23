import type { Signal } from '../types';
import { CONFIG } from '../config';
import { fetchWithRetry } from '../utils/fetch-retry';

interface OddsApiGame {
  id: string;
  bookmakers: Array<{
    key: string;
    markets: Array<{
      key: string;
      outcomes: Array<{ name: string; price: number }>;
    }>;
  }>;
}

export class PinnacleClient {
  private base = 'https://api.the-odds-api.com/v4/sports';

  async getSignal(eventId: string, sport: string): Promise<Signal | null> {
    try {
      const res = await fetchWithRetry(
        `${this.base}/${sport}/odds/?apiKey=${CONFIG.oddsApiKey}&bookmakers=pinnacle&markets=h2h&oddsFormat=decimal`
      );
      const games = (await res.json()) as OddsApiGame[];
      const game = games.find(g => g.id === eventId);
      if (!game?.bookmakers?.[0]?.markets?.[0]?.outcomes) return null;

      const outcomes = game.bookmakers[0].markets[0].outcomes;
      const o1 = 1 / outcomes[0].price;
      const o2 = 1 / outcomes[1].price;
      const total = o1 + o2;
      const trueProb = o1 / total;

      return { trueProb, confidence: 0.85, source: 'pinnacle', timestamp: Date.now() };
    } catch { return null; }
  }
}
