import type { ArbOpportunity, TradeResult } from '../types';

export class DryRun {
  static simulate(opp: ArbOpportunity): TradeResult {
    console.log(`[DRY RUN] Would BUY ${opp.side} ${opp.tokenId} @ $${opp.price.toFixed(2)} for $${opp.sizeUsd.toFixed(0)}`);
    return {
      orderId: `dry_${Date.now()}`,
      status: 'dry_run',
      filledPrice: opp.price,
      sizeUsd: opp.sizeUsd,
      pnl: 0,
    };
  }
}
