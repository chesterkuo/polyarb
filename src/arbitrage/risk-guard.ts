import { CONFIG } from '../config';
import type { ArbOpportunity } from '../types';

export class RiskGuard {
  private dailyLoss = 0;
  private lastResetDate = new Date().toISOString().split('T')[0];
  private totalExposure = 0;
  private openCount = 0;
  private marketCooldowns = new Map<string, number>();

  allow(opp: ArbOpportunity): boolean {
    this.checkDayReset();
    if (this.dailyLoss >= CONFIG.maxDailyLoss) return false;
    if (this.totalExposure + opp.sizeUsd > CONFIG.maxTotalExposure) return false;
    if (this.openCount >= CONFIG.maxOpenPositions) return false;
    if (opp.signal.confidence < CONFIG.minConfidence) return false;
    if (opp.sizeUsd < 5) return false;
    const lastTrade = this.marketCooldowns.get(opp.market.id);
    if (lastTrade && Date.now() - lastTrade < CONFIG.cooldownMs) return false;
    return true;
  }

  recordOpen(positionId: string, sizeUsd: number) {
    this.totalExposure += sizeUsd;
    this.openCount++;
  }

  recordClose(positionId: string, sizeUsd: number, pnl: number) {
    this.totalExposure = Math.max(0, this.totalExposure - sizeUsd);
    this.openCount = Math.max(0, this.openCount - 1);
    if (pnl < 0) this.dailyLoss += Math.abs(pnl);
  }

  setLastTradeTime(marketId: string, timestamp: number) {
    this.marketCooldowns.set(marketId, timestamp);
  }

  private checkDayReset() {
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.lastResetDate) {
      this.dailyLoss = 0;
      this.lastResetDate = today;
    }
  }
}
