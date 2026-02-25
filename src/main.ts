import { privateKeyToAccount } from 'viem/accounts';
import { CONFIG } from './config';
import type { Game, GameFrame, Market, LiveMatch, ArbOpportunity, OpenPosition, Signal, SportGame } from './types';

// Monitoring
import { DbLogger } from './monitoring/db';
import { TelegramAlert } from './monitoring/telegram-alert';
import { HealthServer } from './monitoring/health';

// Data layer
import { GammaScanner } from './data/polymarket-gamma';
import { WsListener } from './data/polymarket-ws';
import { PandaScoreClient } from './data/esports/pandascore-client';
import { diffFrames } from './data/esports/frame-differ';
import { EspnClient } from './data/espn/espn-client';
import { NhlClient } from './data/nhl/nhl-client';
import { PinnacleClient } from './data/pinnacle-client';
import { MarketMatcher } from './data/market-matcher';

// Signals
import { computeEsportsWinProb } from './signals/wp-models/esports-wp';
import { calcNbaWinProb, calcNcaabWinProb } from './signals/wp-models/nba-wp';
import { calcNhlWinProb } from './signals/wp-models/nhl-wp';

// Decision engine
import { ArbDetector } from './arbitrage/detector';
import { RiskGuard } from './arbitrage/risk-guard';

// Execution
import { ClobClient } from './execution/clob-client';
import { DryRun } from './execution/dry-run';
import { PositionManager } from './execution/position-manager';

// Data files
import teamNamesData from '../data/team-names.json';
import marketOverrides from '../data/market-overrides.json';

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------
let running = true;

async function main() {
  console.log('[PolyArb] Starting | dry_run:', CONFIG.dryRun);

  // -----------------------------------------------------------------------
  // 1. Initialize monitoring
  // -----------------------------------------------------------------------
  const db = new DbLogger();
  const telegram = new TelegramAlert(CONFIG.telegramToken, CONFIG.telegramChatId);
  const health = new HealthServer(CONFIG.healthPort);
  console.log('[PolyArb] Monitoring initialized (DB, Telegram, Health on port', CONFIG.healthPort + ')');

  // -----------------------------------------------------------------------
  // 2. Initialize data layer
  // -----------------------------------------------------------------------
  const gamma = new GammaScanner();
  const ws = new WsListener();
  ws.connect();

  const pandascore = new PandaScoreClient(CONFIG.pandascoreKey);
  const espn = new EspnClient();
  const nhlClient = new NhlClient();
  const pinnacle = new PinnacleClient();
  const matcher = new MarketMatcher(
    teamNamesData as any,
    marketOverrides as Record<string, string>,
  );

  console.log('[PolyArb] Data layer initialized');

  // -----------------------------------------------------------------------
  // 3. Initialize signal layer (models are pure functions, no init needed)
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // 4. Initialize decision layer
  // -----------------------------------------------------------------------
  const detector = new ArbDetector();
  const riskGuard = new RiskGuard();
  console.log('[PolyArb] Decision layer initialized');

  // -----------------------------------------------------------------------
  // 5. Initialize execution layer
  // -----------------------------------------------------------------------
  const creds = {
    apiKey: process.env.POLYMARKET_API_KEY ?? '',
    secret: process.env.POLYMARKET_SECRET ?? '',
    passphrase: process.env.POLYMARKET_PASSPHRASE ?? '',
  };

  const account = privateKeyToAccount(CONFIG.polygonKey as `0x${string}`);
  const signerAddress = account.address;

  const clobClient = new ClobClient(creds, CONFIG.polygonKey, CONFIG.proxyAddress, signerAddress);
  const positionManager = new PositionManager();

  console.log('[PolyArb] Execution layer initialized | signer:', signerAddress);

  // -----------------------------------------------------------------------
  // Shared state
  // -----------------------------------------------------------------------
  let esportsMarkets: Market[] = [];
  let nbaMarkets: Market[] = [];
  let ncaabMarkets: Market[] = [];
  let nhlMarkets: Market[] = [];
  const lastFrames = new Map<string, GameFrame>();

  // -----------------------------------------------------------------------
  // Helper: execute an opportunity
  // -----------------------------------------------------------------------
  async function executeOpportunity(opp: ArbOpportunity): Promise<void> {
    const result = CONFIG.dryRun
      ? DryRun.simulate(opp)
      : await clobClient.submitFokOrder(opp);

    // Record in risk guard
    riskGuard.setLastTradeTime(opp.market.id, Date.now());

    if (result.status === 'filled' || result.status === 'dry_run') {
      const posId = `pos_${Date.now()}_${opp.market.id.slice(0, 8)}`;
      riskGuard.recordOpen(posId, opp.sizeUsd);

      const position: OpenPosition = {
        id: posId,
        marketId: opp.market.id,
        tokenId: opp.tokenId,
        side: opp.side,
        entryPrice: result.filledPrice,
        sizeUsd: result.sizeUsd,
        enteredAt: Date.now(),
        highWaterMark: 0,
        currentPrice: result.filledPrice,
      };
      positionManager.addPosition(position);
    }

    // Log to DB
    db.logTrade(opp, result);

    // Notify Telegram
    await telegram.notifyTrade(opp, result);

    // Update health server
    health.lastTradeAt = Date.now();
    health.openPositions = positionManager.getOpenPositions().length;

    console.log(
      `[Trade] ${result.status} | ${opp.side} @ $${result.filledPrice.toFixed(2)} | edge=${(opp.edge * 100).toFixed(1)}% | size=$${opp.sizeUsd.toFixed(0)} | market="${opp.market.question}"`,
    );
  }

  // -----------------------------------------------------------------------
  // Helper: process a sport game signal against markets
  // -----------------------------------------------------------------------
  function matchGameToMarket(game: SportGame, markets: Market[]): Market | undefined {
    return markets.find((m) => {
      const liveMatch: LiveMatch = {
        id: game.id,
        game: 'lol' as Game, // MarketMatcher detects sport from question text or market.sport
        team1: game.homeTeam.abbreviation,
        team2: game.awayTeam.abbreviation,
        status: 'running',
      };
      return matcher.match(m, [liveMatch]) === liveMatch.id;
    });
  }

  function updateMarketPrices(market: Market): void {
    const wsYes = ws.getLatestPrice(market.yesTokenId);
    const wsNo = ws.getLatestPrice(market.noTokenId);
    if (wsYes > 0) market.yesPrice = wsYes;
    if (wsNo > 0) market.noPrice = wsNo;
  }

  async function processSignal(market: Market, signal: Signal): Promise<void> {
    db.logSignal(market.id, signal, market.yesPrice);
    const opp = detector.detect(market, signal);
    if (!opp) return;
    if (!riskGuard.allow(opp)) {
      console.log(`[Risk] Blocked trade on "${market.question}" | edge=${(opp.edge * 100).toFixed(1)}%`);
      return;
    }
    await executeOpportunity(opp);
  }

  function blendSignals(primary: Signal, secondary: Signal): Signal {
    const totalConf = primary.confidence + secondary.confidence;
    return {
      trueProb:
        (primary.trueProb * primary.confidence +
          secondary.trueProb * secondary.confidence) / totalConf,
      confidence: Math.min(0.95, (primary.confidence + secondary.confidence) / 2 + 0.05),
      source: `${primary.source}+${secondary.source}`,
      timestamp: Date.now(),
    };
  }

  // -----------------------------------------------------------------------
  // 6a. Gamma scanner loop — refresh markets & subscribe to WS prices
  // -----------------------------------------------------------------------
  async function gammaScanLoop(): Promise<void> {
    while (running) {
      try {
        const [eMarkets, nMarkets, ncMarkets, nhMarkets] = await Promise.all([
          gamma.getEsportsMarkets(),
          gamma.getNbaMarkets(),
          gamma.getNcaabMarkets(),
          gamma.getNhlMarkets(),
        ]);
        esportsMarkets = eMarkets;
        nbaMarkets = nMarkets;
        ncaabMarkets = ncMarkets;
        nhlMarkets = nhMarkets;

        // Subscribe to WS price feeds for all markets
        for (const m of [...esportsMarkets, ...nbaMarkets, ...ncaabMarkets, ...nhlMarkets]) {
          ws.subscribe(m.yesTokenId);
          ws.subscribe(m.noTokenId);
        }

        health.wsConnected = ws.isConnected();
        console.log(`[Gamma] Refreshed: ${esportsMarkets.length} esports, ${nbaMarkets.length} NBA, ${ncaabMarkets.length} NCAAB, ${nhlMarkets.length} NHL`);
      } catch (err) {
        console.error('[Gamma] Scan error:', err);
      }
      await Bun.sleep(CONFIG.gammaScanMs);
    }
  }

  // -----------------------------------------------------------------------
  // 6b. Esports loop
  // -----------------------------------------------------------------------
  async function esportsLoop(): Promise<void> {
    const games: Game[] = ['lol', 'dota2', 'cs2'];

    while (running) {
      for (const game of games) {
        try {
          const liveMatches = await pandascore.getLiveMatches(game);

          for (const match of liveMatches) {
            // Find corresponding Polymarket market
            const matchedMarket = esportsMarkets.find(
              (m) => matcher.match(m, [match]) === match.id,
            );
            if (!matchedMarket) continue;

            // Fetch frames and diff
            try {
              const frames = await pandascore.getMatchFrames(match.id, game);
              if (frames.length === 0) continue;

              const latestFrame = frames[frames.length - 1];
              const prevFrame = lastFrames.get(match.id);
              lastFrames.set(match.id, latestFrame);

              if (!prevFrame) continue;

              const events = diffFrames(prevFrame, latestFrame);
              if (events.length === 0) continue;

              // Compute win probability from events
              const trueProb = computeEsportsWinProb(events);

              const signal: Signal = {
                trueProb,
                confidence: Math.min(0.95, 0.6 + events.length * 0.05),
                source: `pandascore-${game}`,
                triggeredBy: events.map((e) => e.type).join(','),
                timestamp: Date.now(),
              };

              updateMarketPrices(matchedMarket);
              await processSignal(matchedMarket, signal);
            } catch (frameErr) {
              console.error(`[Esports] Frame error for match ${match.id}:`, frameErr);
            }
          }
        } catch (err) {
          console.error(`[Esports] ${game} poll error:`, err);
        }
      }
      await Bun.sleep(CONFIG.esportsPollMs);
    }
  }

  // -----------------------------------------------------------------------
  // 6c. NBA loop — ESPN primary, logistic fallback, Pinnacle enrichment
  // -----------------------------------------------------------------------
  async function nbaLoop(): Promise<void> {
    while (running) {
      try {
        const liveGames = await espn.getLiveGames('nba');

        for (const game of liveGames) {
          const matchedMarket = matchGameToMarket(game, nbaMarkets);
          if (!matchedMarket) continue;

          // ESPN predictor as primary signal
          let signal = await espn.getPredictor('nba', game.id);

          // Fallback to our logistic model
          if (!signal) {
            const prob = calcNbaWinProb({
              scoreDiff: game.homeTeam.score - game.awayTeam.score,
              period: game.period,
              timeLeft: game.clock || '12:00',
            }, true);
            signal = { trueProb: prob, confidence: 0.70, source: 'nba-logistic', timestamp: Date.now() };
          }

          // Pinnacle enrichment
          const pinnacleSignal = await pinnacle.getSignal(game.id, 'basketball_nba');
          if (pinnacleSignal) {
            signal = blendSignals(signal, pinnacleSignal);
          }

          updateMarketPrices(matchedMarket);
          await processSignal(matchedMarket, signal);
        }
      } catch (err) {
        console.error('[NBA] Poll error:', err);
      }
      await Bun.sleep(CONFIG.nbaPollMs);
    }
  }

  // -----------------------------------------------------------------------
  // 6d. NCAAB loop — ESPN primary, logistic fallback, Pinnacle enrichment
  // -----------------------------------------------------------------------
  async function ncaabLoop(): Promise<void> {
    while (running) {
      try {
        const liveGames = await espn.getLiveGames('ncaab');

        for (const game of liveGames) {
          const matchedMarket = matchGameToMarket(game, ncaabMarkets);
          if (!matchedMarket) continue;

          // ESPN predictor as primary signal
          let signal = await espn.getPredictor('ncaab', game.id);

          // Fallback to our logistic model (2-half format)
          if (!signal) {
            const prob = calcNcaabWinProb({
              scoreDiff: game.homeTeam.score - game.awayTeam.score,
              half: game.period <= 1 ? 1 : 2,
              timeLeft: game.clock || '20:00',
            }, true);
            signal = { trueProb: prob, confidence: 0.70, source: 'ncaab-logistic', timestamp: Date.now() };
          }

          // Pinnacle enrichment
          const pinnacleSignal = await pinnacle.getSignal(game.id, 'basketball_ncaab');
          if (pinnacleSignal) {
            signal = blendSignals(signal, pinnacleSignal);
          }

          updateMarketPrices(matchedMarket);
          await processSignal(matchedMarket, signal);
        }
      } catch (err) {
        console.error('[NCAAB] Poll error:', err);
      }
      await Bun.sleep(CONFIG.ncaabPollMs);
    }
  }

  // -----------------------------------------------------------------------
  // 6e. NHL loop — ESPN primary, logistic fallback, NHL API PBP enrichment
  // -----------------------------------------------------------------------
  async function nhlLoop(): Promise<void> {
    while (running) {
      try {
        const liveGames = await espn.getLiveGames('nhl');

        for (const game of liveGames) {
          const matchedMarket = matchGameToMarket(game, nhlMarkets);
          if (!matchedMarket) continue;

          // ESPN predictor as primary signal
          let signal = await espn.getPredictor('nhl', game.id);

          // Fallback to our logistic model with NHL API power play enrichment
          if (!signal) {
            let homePP = false;
            let awayPP = false;

            // Try to get power play state from NHL Official API
            const pbp = await nhlClient.getPlayByPlay(game.id);
            if (pbp) {
              const ppState = nhlClient.detectPowerPlay(pbp.plays, pbp.homeTeamId);
              homePP = ppState.homePP;
              awayPP = ppState.awayPP;
            }

            const prob = calcNhlWinProb({
              scoreDiff: game.homeTeam.score - game.awayTeam.score,
              period: game.period,
              timeLeft: game.clock || '20:00',
              homePowerPlay: homePP,
              awayPowerPlay: awayPP,
            }, true);
            signal = { trueProb: prob, confidence: 0.70, source: 'nhl-logistic', timestamp: Date.now() };
          }

          // Pinnacle enrichment
          const pinnacleSignal = await pinnacle.getSignal(game.id, 'icehockey_nhl');
          if (pinnacleSignal) {
            signal = blendSignals(signal, pinnacleSignal);
          }

          updateMarketPrices(matchedMarket);
          await processSignal(matchedMarket, signal);
        }
      } catch (err) {
        console.error('[NHL] Poll error:', err);
      }
      await Bun.sleep(CONFIG.nhlPollMs);
    }
  }

  // -----------------------------------------------------------------------
  // 6f. Position manager loop
  // -----------------------------------------------------------------------
  async function positionLoop(): Promise<void> {
    while (running) {
      try {
        // Update prices from WS for all open positions
        for (const pos of positionManager.getOpenPositions()) {
          const wsPrice = ws.getLatestPrice(pos.tokenId);
          if (wsPrice > 0) {
            positionManager.updatePrice(pos.id, wsPrice);
          }
        }

        // Check for exits
        const exits = positionManager.checkExits();
        for (const exit of exits) {
          const pos = positionManager.removePosition(exit.positionId);
          if (!pos) continue;

          const pnl =
            pos.side === 'YES'
              ? (pos.currentPrice - pos.entryPrice) * pos.sizeUsd / pos.entryPrice
              : (pos.entryPrice - pos.currentPrice) * pos.sizeUsd / pos.entryPrice;

          riskGuard.recordClose(exit.positionId, pos.sizeUsd, pnl);
          health.openPositions = positionManager.getOpenPositions().length;

          console.log(
            `[Exit] ${exit.reason} | pos=${exit.positionId} | pnl=$${pnl.toFixed(2)} | market=${pos.marketId}`,
          );
          await telegram.sendAlert(
            `Position closed (${exit.reason}): ${pos.side} on ${pos.marketId} | PnL: $${pnl.toFixed(2)}`,
          );
        }
      } catch (err) {
        console.error('[Position] Check error:', err);
      }
      await Bun.sleep(CONFIG.positionCheckMs);
    }
  }

  // -----------------------------------------------------------------------
  // 7. Register graceful shutdown handlers
  // -----------------------------------------------------------------------
  function shutdown(signal: string) {
    console.log(`[PolyArb] Received ${signal}, shutting down...`);
    running = false;

    ws.close();
    db.close();
    health.stop();

    console.log('[PolyArb] Shutdown complete');
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // -----------------------------------------------------------------------
  // Start all loops concurrently
  // -----------------------------------------------------------------------
  console.log('[PolyArb] All systems go. Starting loops...');
  await telegram.sendAlert('PolyArb started | dry_run: ' + CONFIG.dryRun);

  await Promise.all([
    gammaScanLoop(),
    esportsLoop(),
    nbaLoop(),
    ncaabLoop(),
    nhlLoop(),
    positionLoop(),
  ]);
}

main().catch(console.error);
