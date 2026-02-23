import type { ArbOpportunity, TradeResult } from '../types';

export class TelegramAlert {
  private baseUrl: string;

  constructor(private token: string, private chatId: string) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async send(text: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: this.chatId, text, parse_mode: 'HTML' }),
      });
    } catch (err) { console.error('[Telegram]', err); }
  }

  async notifyTrade(opp: ArbOpportunity, result: TradeResult): Promise<void> {
    const status = result.status === 'filled' ? 'FILLED' : result.status === 'dry_run' ? 'DRY RUN' : 'CANCELLED';
    const text = `[TRADE] BUY ${opp.side} @ $${result.filledPrice.toFixed(2)} | Edge: ${(opp.edge * 100).toFixed(1)}% | Size: $${opp.sizeUsd.toFixed(0)} | Status: ${status} | Market: "${opp.market.question}"`;
    await this.send(text);
  }

  async sendAlert(message: string): Promise<void> {
    await this.send(`[ALERT] ${message}`);
  }

  async sendDailySummary(pnl: number, trades: number, wins: number, losses: number): Promise<void> {
    const text = `[P&L] Daily: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} | ${trades} trades | ${wins}W/${losses}L`;
    await this.send(text);
  }
}
