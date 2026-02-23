import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { ClobClient } from '../../src/execution/clob-client';

describe('ClobClient', () => {
  it('builds HMAC headers correctly', async () => {
    let capturedHeaders: Headers | undefined;
    globalThis.fetch = mock((url: string, init?: any) => {
      capturedHeaders = init?.headers;
      return Promise.resolve(new Response(JSON.stringify({ orderID: 'test-123', success: true })));
    }) as any;

    const client = new ClobClient(
      { apiKey: 'key', secret: Buffer.from('secret').toString('base64'), passphrase: 'pass' },
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    );

    const opp = {
      market: { id: 'm1', conditionId: 'c1', question: 'test', yesTokenId: '12345', noTokenId: '67890', yesPrice: 0.5, noPrice: 0.5, negRisk: false, tickSize: 0.01 },
      signal: { trueProb: 0.7, confidence: 0.9, source: 'test', timestamp: Date.now() },
      side: 'YES' as const, edge: 0.2, tokenId: '12345', price: 0.5, sizeUsd: 100,
    };

    const result = await client.submitFokOrder(opp);
    expect(result.orderId).toBe('test-123');
    expect(result.status).toBe('filled');
    expect(capturedHeaders?.get('POLY_API_KEY')).toBe('key');
    expect(capturedHeaders?.get('POLY_SIGNATURE')).toBeTruthy();
  });
});
