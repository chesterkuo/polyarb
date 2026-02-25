import type { SportGame } from '../../types';
import { fetchWithRetry } from '../../utils/fetch-retry';

const BASE = 'https://api-web.nhle.com/v1';

interface NhlScheduleGame {
  id: number;
  gameState: 'FUT' | 'PRE' | 'LIVE' | 'CRIT' | 'OFF' | 'FINAL';
  period: number;
  clock: { timeRemaining: string };
  homeTeam: { abbrev: string; name: { default: string }; score: number };
  awayTeam: { abbrev: string; name: { default: string }; score: number };
}

interface NhlScheduleResponse {
  gameWeek: Array<{
    games: NhlScheduleGame[];
  }>;
}

export interface NhlPlay {
  typeDescKey: string;
  periodDescriptor: { number: number };
  details?: {
    eventOwnerTeamId?: number;
  };
}

interface NhlPlayByPlayResponse {
  plays: NhlPlay[];
  homeTeam: { id: number };
  awayTeam: { id: number };
}

export interface PowerPlayState {
  homePP: boolean;
  awayPP: boolean;
}

export class NhlClient {
  async getLiveGames(): Promise<SportGame[]> {
    try {
      const res = await fetchWithRetry(`${BASE}/schedule/now`);
      const data = (await res.json()) as NhlScheduleResponse;
      const games: SportGame[] = [];

      for (const day of data.gameWeek ?? []) {
        for (const g of day.games ?? []) {
          if (g.gameState !== 'LIVE' && g.gameState !== 'CRIT') continue;

          games.push({
            id: String(g.id),
            sport: 'nhl',
            homeTeam: {
              name: g.homeTeam.name.default,
              abbreviation: g.homeTeam.abbrev,
              score: g.homeTeam.score ?? 0,
            },
            awayTeam: {
              name: g.awayTeam.name.default,
              abbreviation: g.awayTeam.abbrev,
              score: g.awayTeam.score ?? 0,
            },
            period: g.period ?? 1,
            clock: g.clock?.timeRemaining ?? '20:00',
            status: 'in_progress',
          });
        }
      }

      return games;
    } catch (err) {
      console.error('[NHL] getLiveGames error:', err);
      return [];
    }
  }

  async getPlayByPlay(gameId: string): Promise<{ plays: NhlPlay[]; homeTeamId: number; awayTeamId: number } | null> {
    try {
      const res = await fetchWithRetry(`${BASE}/gamecenter/${gameId}/play-by-play`);
      const data = (await res.json()) as NhlPlayByPlayResponse;
      return {
        plays: data.plays ?? [],
        homeTeamId: data.homeTeam.id,
        awayTeamId: data.awayTeam.id,
      };
    } catch {
      return null;
    }
  }

  detectPowerPlay(plays: NhlPlay[], homeTeamId: number): PowerPlayState {
    let homePenalties = 0;
    let awayPenalties = 0;

    // Look at recent penalty events (last ~10 minutes of plays)
    const recentPlays = plays.slice(-60);
    for (const play of recentPlays) {
      if (play.typeDescKey === 'penalty') {
        if (play.details?.eventOwnerTeamId === homeTeamId) {
          homePenalties++;
        } else {
          awayPenalties++;
        }
      }
      if (play.typeDescKey === 'penalty-end') {
        if (play.details?.eventOwnerTeamId === homeTeamId) {
          homePenalties = Math.max(0, homePenalties - 1);
        } else {
          awayPenalties = Math.max(0, awayPenalties - 1);
        }
      }
    }

    return {
      homePP: awayPenalties > homePenalties,
      awayPP: homePenalties > awayPenalties,
    };
  }
}
