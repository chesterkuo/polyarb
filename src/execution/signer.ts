import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

export const EXCHANGE_ADDRESSES = {
  CTF: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E' as Hex,
  NEG_RISK: '0xC5d563A36AE78145C45a50134d48A1215220f80a' as Hex,
} as const;

const ORDER_TYPES = {
  Order: [
    { name: 'salt', type: 'uint256' },
    { name: 'maker', type: 'address' },
    { name: 'signer', type: 'address' },
    { name: 'taker', type: 'address' },
    { name: 'tokenId', type: 'uint256' },
    { name: 'makerAmount', type: 'uint256' },
    { name: 'takerAmount', type: 'uint256' },
    { name: 'expiration', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'feeRateBps', type: 'uint256' },
    { name: 'side', type: 'uint8' },
    { name: 'signatureType', type: 'uint8' },
  ],
} as const;

export interface OrderStruct {
  salt: string;
  maker: string;
  signer: string;
  taker: string;
  tokenId: string;
  makerAmount: string;
  takerAmount: string;
  expiration: string;
  nonce: string;
  feeRateBps: string;
  side: 0 | 1;
  signatureType: 0 | 1 | 2;
}

export class OrderSigner {
  private account: ReturnType<typeof privateKeyToAccount>;

  constructor(privateKey: string, public readonly signerAddress: string) {
    this.account = privateKeyToAccount(privateKey as Hex);
  }

  async signOrder(order: OrderStruct, negRisk: boolean): Promise<string> {
    const domain = {
      name: 'ClobExchange' as const,
      version: '1' as const,
      chainId: 137,
      verifyingContract: negRisk ? EXCHANGE_ADDRESSES.NEG_RISK : EXCHANGE_ADDRESSES.CTF,
    };

    const signature = await this.account.signTypedData({
      domain,
      types: ORDER_TYPES,
      primaryType: 'Order',
      message: {
        salt: BigInt(order.salt),
        maker: order.maker as Hex,
        signer: order.signer as Hex,
        taker: order.taker as Hex,
        tokenId: BigInt(order.tokenId),
        makerAmount: BigInt(order.makerAmount),
        takerAmount: BigInt(order.takerAmount),
        expiration: BigInt(order.expiration),
        nonce: BigInt(order.nonce),
        feeRateBps: BigInt(order.feeRateBps),
        side: order.side,
        signatureType: order.signatureType,
      },
    });

    const typeByte = order.signatureType.toString(16).padStart(2, '0');
    return signature + typeByte;
  }
}
