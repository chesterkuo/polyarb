import type { Sport, SportGame, Signal } from '../../types';
import { fetchWithRetry } from '../../utils/fetch-retry';

const SPORT_PATHS: Record<string, string> = {
  nba: 'basketball/nba',
  ncaab: 'basketball/mens-college-basketball',
  nhl: 'hockey/nhl',
};

const SCOREBOARD_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const PREDICTOR_BASE = 'https://sports.core.api.espn.com/v2/sports';

interface EspnCompetitor {
  homeAway: 'home' | 'away';
  team: { displayName: string; abbreviation: string };
  score: string;
}

interface EspnStatus {
  type: { state: 'pre' | 'in' | 'post'; detail: string };
  period: number;
  displayClock: string;
}

interface EspnEvent {
  id: string;
  competitions: Array<{
    competitors: EspnCompetitor[];
    status: EspnStatus;
  }>;
}

interface EspnScoreboard {
  events: EspnEvent[];
}

interface EspnPredictor {
  homeProjectedWinPercentage?: number;
  awayProjectedWinPercentage?: number;
}

function mapStatus(state: string): SportGame['status'] {
  if (state === 'in') return 'in_progress';
  if (state === 'post') return 'final';
  return 'scheduled';
}

export class EspnClient {
  async getLiveGames(sport: Sport): Promise<SportGame[]> {
    const path = SPORT_PATHS[sport];
    if (!path) return [];

    try {
      const res = await fetchWithRetry(`${SCOREBOARD_BASE}/${path}/scoreboard`);
      const data = (await res.json()) as EspnScoreboard;
      const games: SportGame[] = [];

      for (const event of data.events ?? []) {
        const comp = event.competitions?.[0];
        if (!comp) continue;

        const status = comp.status;
        if (status.type.state !== 'in') continue;

        const home = comp.competitors.find((c) => c.homeAway === 'home');
        const away = comp.competitors.find((c) => c.homeAway === 'away');
        if (!home || !away) continue;

        games.push({
          id: event.id,
          sport,
          homeTeam: {
            name: home.team.displayName,
            abbreviation: home.team.abbreviation,
            score: parseInt(home.score, 10) || 0,
          },
          awayTeam: {
            name: away.team.displayName,
            abbreviation: away.team.abbreviation,
            score: parseInt(away.score, 10) || 0,
          },
          period: status.period,
          clock: status.displayClock,
          status: mapStatus(status.type.state),
        });
      }

      return games;
    } catch (err) {
      console.error(`[ESPN] getLiveGames(${sport}) error:`, err);
      return [];
    }
  }

  async getPredictor(sport: Sport, eventId: string): Promise<Signal | null> {
    const path = SPORT_PATHS[sport];
    if (!path) return null;

    try {
      const res = await fetchWithRetry(
        `${PREDICTOR_BASE}/${path}/events/${eventId}/competitions/${eventId}/predictor`,
      );
      const data = (await res.json()) as EspnPredictor;

      const homeWp = data.homeProjectedWinPercentage;
      if (homeWp == null) return null;

      return {
        trueProb: homeWp,
        confidence: 0.80,
        source: `espn-predictor-${sport}`,
        timestamp: Date.now(),
      };
    } catch {
      return null;
    }
  }
}
