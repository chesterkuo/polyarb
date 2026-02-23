import type { Market } from '../types';
import { CONFIG } from '../config';
import { fetchWithRetry } from '../utils/fetch-retry';

interface GammaMarketRaw {
  id: string; conditionId: string; question: string;
  clobTokenIds: string[]; outcomePrices: string[];
  active: boolean; closed: boolean; acceptingOrders: boolean;
  negRisk: boolean;
}

interface GammaEvent {
  id: string; title: string; active: boolean; closed: boolean;
  markets: GammaMarketRaw[];
}

const ESPORTS_PREFIXES = ['lol:', 'dota 2:', 'cs2:', 'cs:', 'valorant:', 'counter-strike:', 'honor of kings:'];
const NBA_KEYWORDS = ['nba'];

function isEsportsEvent(title: string): boolean {
  const t = title.toLowerCase().trim();
  return ESPORTS_PREFIXES.some((p) => t.startsWith(p));
}

function isNbaEvent(title: string): boolean {
  const t = title.toLowerCase();
  return NBA_KEYWORDS.some((k) => t.includes(k));
}

function toMarket(m: GammaMarketRaw): Market {
  return {
    id: m.id, conditionId: m.conditionId, question: m.question,
    yesTokenId: m.clobTokenIds[0], noTokenId: m.clobTokenIds[1],
    yesPrice: parseFloat(m.outcomePrices[0]), noPrice: parseFloat(m.outcomePrices[1]),
    negRisk: m.negRisk ?? false, tickSize: 0.01,
  };
}

export class GammaScanner {
  private cachedEvents: GammaEvent[] = [];
  private cacheTime = 0;

  private async fetchAllEvents(): Promise<GammaEvent[]> {
    // Cache for 30s to avoid double-fetching when getEsportsMarkets + getNbaMarkets called together
    if (Date.now() - this.cacheTime < 30_000 && this.cachedEvents.length > 0) {
      return this.cachedEvents;
    }
    const all: GammaEvent[] = [];
    const PAGE = 500;
    for (let offset = 0; offset < 5000; offset += PAGE) {
      const res = await fetchWithRetry(
        `${CONFIG.gammaHost}/events?active=true&closed=false&limit=${PAGE}&offset=${offset}`,
      );
      const page = (await res.json()) as GammaEvent[];
      if (page.length === 0) break;
      all.push(...page);
    }
    this.cachedEvents = all;
    this.cacheTime = Date.now();
    return all;
  }

  private extractMarkets(events: GammaEvent[], filter: (title: string) => boolean): Market[] {
    const markets: Market[] = [];
    for (const event of events) {
      if (!filter(event.title)) continue;
      for (const m of event.markets ?? []) {
        if (m.active && m.acceptingOrders && !m.closed) {
          markets.push(toMarket(m));
        }
      }
    }
    return markets;
  }

  async getEsportsMarkets(): Promise<Market[]> {
    const events = await this.fetchAllEvents();
    return this.extractMarkets(events, isEsportsEvent);
  }

  async getNbaMarkets(): Promise<Market[]> {
    const events = await this.fetchAllEvents();
    return this.extractMarkets(events, isNbaEvent);
  }
}
