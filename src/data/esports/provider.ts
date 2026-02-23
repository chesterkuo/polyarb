import type { LiveMatch, GameFrame, Game } from '../../types';

export interface EsportsDataProvider {
  getLiveMatches(game: Game): Promise<LiveMatch[]>;
  getMatchFrames(matchId: string): Promise<GameFrame[]>;
}
