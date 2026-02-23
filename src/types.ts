export type Side = 'YES' | 'NO';
export type Sport = 'lol' | 'dota2' | 'cs2' | 'nba';
export type Game = 'lol' | 'dota2' | 'cs2';

export interface Market {
  id: string;
  conditionId: string;
  question: string;
  yesTokenId: string;
  noTokenId: string;
  yesPrice: number;
  noPrice: number;
  externalId?: string;
  sport?: Sport;
  negRisk: boolean;
  tickSize: number;
}

export interface Signal {
  trueProb: number;
  confidence: number;
  source: string;
  triggeredBy?: string;
  timestamp: number;
}

export interface ArbOpportunity {
  market: Market;
  signal: Signal;
  side: Side;
  edge: number;
  tokenId: string;
  price: number;
  sizeUsd: number;
}

export interface TradeResult {
  orderId: string;
  status: 'filled' | 'cancelled' | 'dry_run';
  filledPrice: number;
  sizeUsd: number;
  pnl?: number;
}

export interface OpenPosition {
  id: string;
  marketId: string;
  tokenId: string;
  side: Side;
  entryPrice: number;
  sizeUsd: number;
  enteredAt: number;
  highWaterMark: number;
  currentPrice: number;
}

export interface LiveMatch {
  id: string;
  game: Game;
  team1: string;
  team2: string;
  status: 'running' | 'finished';
  league?: string;
}

export interface TeamFrame {
  name: string;
  kills: number;
  gold: number;
  towers: number;
  inhibitors: number;
  dragons?: number;
  barons?: number;
  roshans?: number;
  score?: number;
}

export interface GameFrame {
  timestamp: number;
  gameTimeSeconds: number;
  teams: [TeamFrame, TeamFrame];
}

export type GameEventType =
  | 'dragon_kill' | 'baron_kill' | 'tower_kill' | 'inhibitor_kill'
  | 'roshan_kill' | 'barracks_kill' | 'round_win' | 'map_win' | 'game_end';

export interface GameEvent {
  type: GameEventType;
  team: 'team1' | 'team2';
  timestamp: number;
}
