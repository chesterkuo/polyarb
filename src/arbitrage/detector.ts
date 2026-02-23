import type { Market, Signal, ArbOpportunity } from '../types';
import { CONFIG } from '../config';
import { calcEdge, calcKellySize } from '../signals/edge-calculator';

function shouldExecute(confidence: number, confirmCount: number): boolean {
  if (confidence >= 0.85) return true;
  if (confidence >= 0.70) return confirmCount >= 2;
  return confirmCount >= 3;
}

export class ArbDetector {
  private confirmCounts = new Map<string, number>();

  detect(market: Market, signal: Signal): ArbOpportunity | null {
    const { side, edge } = calcEdge(signal.trueProb, market.yesPrice, market.noPrice);
    if (edge < CONFIG.minEdge) {
      this.confirmCounts.delete(market.yesTokenId);
      return null;
    }
    const key = market.yesTokenId;
    const count = (this.confirmCounts.get(key) ?? 0) + 1;
    this.confirmCounts.set(key, count);
    if (!shouldExecute(signal.confidence, count)) return null;
    this.confirmCounts.delete(key);

    const tokenId = side === 'YES' ? market.yesTokenId : market.noTokenId;
    const price = side === 'YES' ? market.yesPrice : market.noPrice;
    const trueP = side === 'YES' ? signal.trueProb : 1 - signal.trueProb;
    const sizeUsd = calcKellySize(trueP, price);
    if (sizeUsd < 5) return null;
    return { market, signal, side, edge, tokenId, price, sizeUsd };
  }
}
