import { Database } from 'bun:sqlite';
import type { ArbOpportunity, TradeResult, Signal } from '../types';

export class DbLogger {
  private db: Database;

  constructor(path: string = 'data/polyarb.db') {
    this.db = new Database(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        market_id TEXT NOT NULL,
        token_id TEXT NOT NULL,
        side TEXT NOT NULL,
        edge REAL NOT NULL,
        size_usd REAL NOT NULL,
        price REAL NOT NULL,
        status TEXT NOT NULL,
        pnl REAL,
        signal_source TEXT,
        signal_confidence REAL
      );
      CREATE TABLE IF NOT EXISTS signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        market_id TEXT NOT NULL,
        true_prob REAL NOT NULL,
        market_price REAL NOT NULL,
        edge REAL NOT NULL,
        source TEXT NOT NULL,
        triggered_by TEXT
      );
      CREATE TABLE IF NOT EXISTS daily_summary (
        date TEXT PRIMARY KEY,
        total_trades INTEGER,
        wins INTEGER,
        losses INTEGER,
        total_pnl REAL,
        max_drawdown REAL
      );
    `);
  }

  logTrade(opp: ArbOpportunity, result: TradeResult) {
    this.db.run(
      `INSERT INTO trades (timestamp, market_id, token_id, side, edge, size_usd, price, status, pnl, signal_source, signal_confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [Date.now(), opp.market.id, opp.tokenId, opp.side, opp.edge, opp.sizeUsd, result.filledPrice, result.status, result.pnl ?? null, opp.signal.source, opp.signal.confidence],
    );
  }

  logSignal(marketId: string, signal: Signal, marketPrice: number) {
    this.db.run(
      `INSERT INTO signals (timestamp, market_id, true_prob, market_price, edge, source, triggered_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [signal.timestamp, marketId, signal.trueProb, marketPrice, signal.trueProb - marketPrice, signal.source, signal.triggeredBy ?? null],
    );
  }

  getDb() { return this.db; }
  close() { this.db.close(); }
}
