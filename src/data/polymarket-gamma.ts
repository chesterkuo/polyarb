import type { Market, Sport } from '../types';
import { CONFIG } from '../config';
import { fetchWithRetry } from '../utils/fetch-retry';

interface GammaMarketRaw {
  id: string; conditionId: string; question: string;
  clobTokenIds: string[] | string; outcomePrices: string[] | string;
  active: boolean; closed: boolean; acceptingOrders: boolean;
  negRisk: boolean;
}

interface GammaEvent {
  id: string; title: string; active: boolean; closed: boolean;
  markets: GammaMarketRaw[];
}

const ESPORTS_PREFIXES = ['lol:', 'dota 2:', 'cs2:', 'cs:', 'valorant:', 'counter-strike:', 'honor of kings:'];
const NBA_KEYWORDS = ['nba'];
const NCAAB_KEYWORDS = ['ncaa', 'ncaab', 'march madness', 'college basketball'];
const NHL_KEYWORDS = ['nhl', 'hockey'];

function isEsportsEvent(title: string): boolean {
  const t = title.toLowerCase().trim();
  return ESPORTS_PREFIXES.some((p) => t.startsWith(p));
}

function isNbaEvent(title: string): boolean {
  const t = title.toLowerCase();
  return NBA_KEYWORDS.some((k) => t.includes(k));
}

function isNcaabEvent(title: string): boolean {
  const t = title.toLowerCase();
  return NCAAB_KEYWORDS.some((k) => t.includes(k));
}

function isNhlEvent(title: string): boolean {
  const t = title.toLowerCase();
  return NHL_KEYWORDS.some((k) => t.includes(k));
}

function parseJsonArray(val: string[] | string): string[] {
  if (Array.isArray(val)) return val;
  try { return JSON.parse(val); } catch { return []; }
}

function toMarket(m: GammaMarketRaw, sport?: Sport): Market {
  const tokenIds = parseJsonArray(m.clobTokenIds);
  const prices = parseJsonArray(m.outcomePrices);
  return {
    id: m.id, conditionId: m.conditionId, question: m.question,
    yesTokenId: tokenIds[0] ?? '', noTokenId: tokenIds[1] ?? '',
    yesPrice: parseFloat(prices[0]) || 0, noPrice: parseFloat(prices[1]) || 0,
    negRisk: m.negRisk ?? false, tickSize: 0.01,
    sport,
  };
}

export class GammaScanner {
  private cachedEvents: GammaEvent[] = [];
  private cacheTime = 0;

  private async fetchAllEvents(): Promise<GammaEvent[]> {
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

  private extractMarkets(events: GammaEvent[], filter: (title: string) => boolean, sport?: Sport): Market[] {
    const markets: Market[] = [];
    for (const event of events) {
      if (!filter(event.title)) continue;
      for (const m of event.markets ?? []) {
        if (m.active && m.acceptingOrders && !m.closed) {
          markets.push(toMarket(m, sport));
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
    return this.extractMarkets(events, isNbaEvent, 'nba');
  }

  async getNcaabMarkets(): Promise<Market[]> {
    const events = await this.fetchAllEvents();
    return this.extractMarkets(events, isNcaabEvent, 'ncaab');
  }

  async getNhlMarkets(): Promise<Market[]> {
    const events = await this.fetchAllEvents();
    return this.extractMarkets(events, isNhlEvent, 'nhl');
  }
}
