import type { ArbOpportunity } from '../types';
import { CONFIG } from '../config';
import type { OrderStruct } from './signer';

export class OrderBuilder {
  constructor(
    private proxyAddress: string,
    private signerAddress: string,
  ) {}

  build(opp: ArbOpportunity): OrderStruct {
    const price = opp.price;
    const sizeUsdc = opp.sizeUsd;

    // BUY: makerAmount = USDC to spend, takerAmount = CT tokens to receive
    const makerAmount = Math.floor(sizeUsdc * 1e6);
    const takerAmount = Math.floor((sizeUsdc / price) * 1e6);

    return {
      salt: String(Math.floor(Math.random() * 2 ** 48)),
      maker: this.proxyAddress,
      signer: this.signerAddress,
      taker: '0x0000000000000000000000000000000000000000',
      tokenId: opp.tokenId,
      makerAmount: String(makerAmount),
      takerAmount: String(takerAmount),
      expiration: '0',
      nonce: '0',
      feeRateBps: '0',
      side: 0,
      signatureType: 1,
    };
  }
}
