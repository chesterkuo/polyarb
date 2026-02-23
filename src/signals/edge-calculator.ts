import type { Side } from '../types';
import { CONFIG } from '../config';

export function calcEdge(trueProb: number, yesPrice: number, noPrice: number): { side: Side; edge: number } {
  const edgeYes = trueProb - yesPrice;
  const edgeNo = (1 - trueProb) - noPrice;
  if (edgeYes >= edgeNo) return { side: 'YES', edge: edgeYes };
  return { side: 'NO', edge: edgeNo };
}

export function calcKellySize(
  trueProb: number,
  price: number,
  kellyFraction: number = CONFIG.kellyFraction,
  totalCapital: number = CONFIG.totalCapitalUsd,
): number {
  const b = (1 / price) - 1;
  if (b <= 0) return 0;
  const kelly = Math.max(0, (b * trueProb - (1 - trueProb)) / b);
  const size = Math.min(CONFIG.maxPositionUsd, kelly * kellyFraction * totalCapital);
  return size < 5 ? 0 : size;
}
