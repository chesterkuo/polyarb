import type { Market } from '../types';
import { CONFIG } from '../config';
import { fetchWithRetry } from '../utils/fetch-retry';

interface GammaMarketRaw {
  id: string; conditionId: string; question: string;
  clobTokenIds: string[]; outcomePrices: string[];
  active: boolean; closed: boolean; acceptingOrders: boolean;
  tags: string[]; negRisk: boolean;
}

export class GammaScanner {
  async getMarkets(tag: string): Promise<Market[]> {
    const res = await fetchWithRetry(`${CONFIG.gammaHost}/markets?active=true&tag=${tag}&limit=100`);
    const data = (await res.json()) as GammaMarketRaw[];
    return data
      .filter((m) => m.active && m.acceptingOrders && !m.closed)
      .map((m) => ({
        id: m.id, conditionId: m.conditionId, question: m.question,
        yesTokenId: m.clobTokenIds[0], noTokenId: m.clobTokenIds[1],
        yesPrice: parseFloat(m.outcomePrices[0]), noPrice: parseFloat(m.outcomePrices[1]),
        negRisk: m.negRisk ?? false, tickSize: 0.01,
      }));
  }

  async getEsportsMarkets(): Promise<Market[]> { return this.getMarkets('esports'); }
  async getNbaMarkets(): Promise<Market[]> { return this.getMarkets('nba'); }
}
