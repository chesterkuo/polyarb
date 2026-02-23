import type { EsportsDataProvider } from './provider';
import type { LiveMatch, GameFrame, Game, TeamFrame } from '../../types';
import { fetchWithRetry } from '../../utils/fetch-retry';

const GAME_SLUGS: Record<Game, string> = { lol: 'lol', dota2: 'dota2', cs2: 'csgo' };

interface PandaMatch {
  id: number;
  name: string;
  status: string;
  opponents: Array<{ opponent: { name: string } }>;
  league?: { name: string };
  games?: Array<{ id: number; status: string }>;
}

interface PandaFrame {
  timestamp: number;
  teams: Array<{
    name: string; kills: number; gold_earned: number; tower_kills: number;
    inhibitor_kills?: number; dragon_kills?: number; baron_kills?: number;
    roshan_kills?: number; score?: number;
  }>;
}

export class PandaScoreClient implements EsportsDataProvider {
  private baseUrl = 'https://api.pandascore.co';
  private headers: HeadersInit;

  constructor(apiKey: string) {
    this.headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };
  }

  async getLiveMatches(game: Game): Promise<LiveMatch[]> {
    const slug = GAME_SLUGS[game];
    const res = await fetchWithRetry(`${this.baseUrl}/${slug}/matches/running`, { headers: this.headers });
    const data = (await res.json()) as PandaMatch[];
    return data.map((m) => ({
      id: String(m.id), game,
      team1: m.opponents[0]?.opponent?.name ?? 'Unknown',
      team2: m.opponents[1]?.opponent?.name ?? 'Unknown',
      status: m.status === 'running' ? 'running' as const : 'finished' as const,
      league: m.league?.name,
    }));
  }

  async getMatchFrames(gameId: string): Promise<GameFrame[]> {
    const res = await fetchWithRetry(`${this.baseUrl}/lol/games/${gameId}/frames`, { headers: this.headers });
    const data = (await res.json()) as PandaFrame[];
    return data.map((f) => ({
      timestamp: f.timestamp, gameTimeSeconds: 0,
      teams: [this.toTeamFrame(f.teams[0]), this.toTeamFrame(f.teams[1])] as [TeamFrame, TeamFrame],
    }));
  }

  private toTeamFrame(t: PandaFrame['teams'][0]): TeamFrame {
    return {
      name: t.name, kills: t.kills, gold: t.gold_earned, towers: t.tower_kills,
      inhibitors: t.inhibitor_kills ?? 0, dragons: t.dragon_kills, barons: t.baron_kills,
      roshans: t.roshan_kills, score: t.score,
    };
  }
}
