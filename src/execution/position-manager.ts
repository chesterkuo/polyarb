import type { OpenPosition, Side, TradeResult } from '../types';
import { CONFIG } from '../config';

export type ExitReason = 'take_profit' | 'trailing_stop' | 'hard_stop' | 'max_hold_time' | 'market_convergence';

export class PositionManager {
  private positions = new Map<string, OpenPosition>();

  addPosition(pos: OpenPosition) {
    this.positions.set(pos.id, pos);
  }

  updatePrice(positionId: string, currentPrice: number) {
    const pos = this.positions.get(positionId);
    if (!pos) return;
    pos.currentPrice = currentPrice;
    // Update high water mark
    const unrealizedPnl = this.calcUnrealizedPnl(pos);
    if (unrealizedPnl > pos.highWaterMark) {
      pos.highWaterMark = unrealizedPnl;
    }
  }

  checkExits(): Array<{ positionId: string; reason: ExitReason }> {
    const exits: Array<{ positionId: string; reason: ExitReason }> = [];

    for (const [id, pos] of this.positions) {
      const pnl = this.calcUnrealizedPnl(pos);
      const entryEdge = pos.side === 'YES'
        ? pos.currentPrice - pos.entryPrice
        : pos.entryPrice - pos.currentPrice;

      // Hard stop-loss (highest priority)
      if (pnl < -(pos.sizeUsd * CONFIG.hardStopLossPct)) {
        exits.push({ positionId: id, reason: 'hard_stop' });
        continue;
      }

      // Trailing stop
      if (pos.highWaterMark > 0 && pnl < pos.highWaterMark * (1 - CONFIG.trailingStopPct)) {
        exits.push({ positionId: id, reason: 'trailing_stop' });
        continue;
      }

      // Take profit
      if (entryEdge > 0 && pnl > pos.sizeUsd * entryEdge * CONFIG.takeProfitMultiplier) {
        exits.push({ positionId: id, reason: 'take_profit' });
        continue;
      }

      // Max hold time
      if (Date.now() - pos.enteredAt > CONFIG.maxHoldTimeMs) {
        exits.push({ positionId: id, reason: 'max_hold_time' });
        continue;
      }
    }

    return exits;
  }

  removePosition(positionId: string): OpenPosition | undefined {
    const pos = this.positions.get(positionId);
    this.positions.delete(positionId);
    return pos;
  }

  getPosition(positionId: string): OpenPosition | undefined {
    return this.positions.get(positionId);
  }

  getOpenPositions(): OpenPosition[] {
    return Array.from(this.positions.values());
  }

  private calcUnrealizedPnl(pos: OpenPosition): number {
    if (pos.side === 'YES') {
      return (pos.currentPrice - pos.entryPrice) * pos.sizeUsd / pos.entryPrice;
    }
    return (pos.entryPrice - pos.currentPrice) * pos.sizeUsd / pos.entryPrice;
  }
}
