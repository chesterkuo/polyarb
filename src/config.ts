export const CONFIG = {
  minEdge: 0.08,
  kellyFraction: 0.25,
  maxPositionUsd: 500,
  maxDailyLoss: 300,
  totalCapitalUsd: 10_000,
  dryRun: process.env.DRY_RUN !== 'false',

  takeProfitMultiplier: 1.5,
  trailingStopPct: 0.40,
  hardStopLossPct: 0.50,
  maxHoldTimeMs: 10 * 60 * 1000,

  clobHost: 'https://clob.polymarket.com',
  gammaHost: 'https://gamma-api.polymarket.com',
  wssHost: 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
  chainId: 137,
  ctfExchange: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
  negRiskExchange: '0xC5d563A36AE78145C45a50134d48A1215220f80a',

  polygonKey: process.env.POLYGON_PRIVATE_KEY ?? '',
  proxyAddress: process.env.POLYMARKET_PROXY_ADDRESS ?? '',
  pandascoreKey: process.env.PANDASCORE_API_KEY ?? '',
  steamApiKey: process.env.STEAM_API_KEY ?? '',
  oddsApiKey: process.env.ODDS_API_KEY ?? '',
  bdlApiKey: process.env.BDL_API_KEY ?? '',
  telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? '',

  esportsPollMs: 200,
  esportsFramePollMs: 3000,
  nbaPollMs: 1000,
  gammaScanMs: 60_000,
  positionCheckMs: 2000,

  maxRetries: 3,
  retryBaseMs: 1000,

  healthPort: 3000,

  maxOpenPositions: 8,
  maxTotalExposure: 5000,
  cooldownMs: 30_000,
  minConfidence: 0.6,
} as const;
