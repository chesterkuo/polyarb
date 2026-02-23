import { createHmac } from 'node:crypto';
import type { ArbOpportunity, TradeResult } from '../types';
import { CONFIG } from '../config';
import { OrderBuilder } from './order-builder';
import { OrderSigner } from './signer';

interface ApiCreds {
  apiKey: string;
  secret: string;
  passphrase: string;
}

export class ClobClient {
  private builder: OrderBuilder;
  private signer: OrderSigner;

  constructor(
    private creds: ApiCreds,
    privateKey: string,
    proxyAddress: string,
    signerAddress: string,
  ) {
    this.builder = new OrderBuilder(proxyAddress, signerAddress);
    this.signer = new OrderSigner(privateKey, signerAddress);
  }

  private buildHeaders(method: string, path: string, body = ''): Headers {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const message = timestamp + method.toUpperCase() + path + body;
    const secret = Buffer.from(this.creds.secret, 'base64');
    const sig = createHmac('sha256', secret).update(message).digest('base64');

    const h = new Headers();
    h.set('Content-Type', 'application/json');
    h.set('POLY_ADDRESS', CONFIG.proxyAddress);
    h.set('POLY_API_KEY', this.creds.apiKey);
    h.set('POLY_PASSPHRASE', this.creds.passphrase);
    h.set('POLY_TIMESTAMP', timestamp);
    h.set('POLY_SIGNATURE', sig);
    return h;
  }

  async getMidpoint(tokenId: string): Promise<number> {
    const res = await fetch(`${CONFIG.clobHost}/midpoint?token_id=${tokenId}`);
    const data = await res.json() as { mid: string };
    return parseFloat(data.mid);
  }

  async submitFokOrder(opp: ArbOpportunity): Promise<TradeResult> {
    const orderStruct = this.builder.build(opp);
    const signature = await this.signer.signOrder(orderStruct, opp.market.negRisk);

    const orderPayload = {
      order: {
        ...orderStruct,
        side: 'BUY',
        signature,
      },
      owner: orderStruct.maker,
      orderType: 'FOK',
    };

    const body = JSON.stringify(orderPayload);
    const path = '/order';
    const headers = this.buildHeaders('POST', path, body);

    const res = await fetch(`${CONFIG.clobHost}${path}`, {
      method: 'POST', headers, body,
    });

    const data = await res.json() as { orderID?: string; success?: boolean; status?: string };

    return {
      orderId: data.orderID ?? 'UNKNOWN',
      status: data.success ? 'filled' : 'cancelled',
      filledPrice: opp.price,
      sizeUsd: opp.sizeUsd,
    };
  }
}
