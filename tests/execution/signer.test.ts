import { describe, it, expect } from 'bun:test';
import { OrderSigner } from '../../src/execution/signer';
import { privateKeyToAccount } from 'viem/accounts';

describe('OrderSigner', () => {
  // Hardhat test key #0 — not real money
  const testKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const account = privateKeyToAccount(testKey);
  const signer = new OrderSigner(testKey, account.address);

  it('signs an order and returns hex signature with type suffix', async () => {
    const sig = await signer.signOrder({
      salt: '12345',
      maker: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      signer: account.address,
      taker: '0x0000000000000000000000000000000000000000',
      tokenId: '999',
      makerAmount: '100000000',
      takerAmount: '200000000',
      expiration: '0',
      nonce: '0',
      feeRateBps: '0',
      side: 0,
      signatureType: 1,
    }, false);

    // viem produces 65-byte signature (0x + 130 hex chars), plus 2 hex chars for type byte = 134 total
    expect(sig).toMatch(/^0x[a-f0-9]+01$/);
    expect(sig.length).toBe(2 + 130 + 2); // 0x + 65-byte sig hex + type byte hex
  });

  it('produces different signatures for different exchanges', async () => {
    const order = {
      salt: '1', maker: account.address, signer: account.address,
      taker: '0x0000000000000000000000000000000000000000',
      tokenId: '1', makerAmount: '1', takerAmount: '1',
      expiration: '0', nonce: '0', feeRateBps: '0',
      side: 0 as const, signatureType: 1 as const,
    };
    const sigNormal = await signer.signOrder(order, false);
    const sigNegRisk = await signer.signOrder(order, true);
    expect(sigNormal).not.toBe(sigNegRisk);
  });
});
