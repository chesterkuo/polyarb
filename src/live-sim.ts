/**
 * Live multi-sport dry-run simulation (NBA + NCAAB + NHL).
 * Uses Kalshi game markets instead of Polymarket for individual game betting.
 * Polls ESPN every 2 minutes, matches games to Kalshi markets via ticker,
 * checks orderbook liquidity before sizing trades.
 *
 * Usage: bun run src/live-sim.ts
 */

import { CONFIG } from './config';
import type { Market, Signal, Side, Sport, SportGame } from './types';
import { KalshiClient, type KalshiMarket, type KalshiOrderBook } from './data/kalshi/kalshi-client';
import { EspnClient } from './data/espn/espn-client';
import { calcEdge } from './signals/edge-calculator';
import { calcNbaWinProb, calcNcaabWinProb } from './signals/wp-models/nba-wp';
import { calcNhlWinProb } from './signals/wp-models/nhl-wp';
import { parseClockToMinutes } from './signals/wp-models/parse-clock';

// ─── Config ──────────────────────────────────────────────────────────────────
const STARTING_BALANCE = 50;
const MAX_POSITION     = 10;
const KELLY_FRACTION   = 0.25;
const MIN_EDGE         = CONFIG.minEdge;
const POLL_INTERVAL_MS = 2 * 60 * 1000;
const COOLDOWN_MS      = 5 * 60 * 1000;   // 5 min cooldown per market
const MAX_PER_MARKET   = 15;               // Max $15 per market (diversification)
const MAX_POLLS        = 120;
const LOG_FILE         = 'data/logs/live-sim-' + new Date().toISOString().replace(/[:.]/g, '-') + '.log';

// ─── State ───────────────────────────────────────────────────────────────────
interface SimTrade {
  poll: number;
  time: string;
  sport: string;
  game: string;
  market: string;
  side: Side;
  price: number;
  sizeUsd: number;
  edge: number;
  trueProb: number;
  source: string;
  liquidity?: { avgPrice: number; availableQty: number };
}

const trades: SimTrade[] = [];
const cooldowns = new Map<string, number>();
const marketExposure = new Map<string, number>(); // per-market exposure cap
let balance = STARTING_BALANCE;
let totalExposure = 0;

function kellySize(trueProb: number, price: number): number {
  const b = (1 / price) - 1;
  if (b <= 0) return 0;
  const kelly = Math.max(0, (b * trueProb - (1 - trueProb)) / b);
  const remainingCapital = balance - totalExposure;
  const size = Math.min(MAX_POSITION, kelly * KELLY_FRACTION * remainingCapital);
  return size < 2 ? 0 : size;
}

function log(msg: string) {
  const ts = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  const line = `[${ts}] ${msg}`;
  console.log(line);
  Bun.write(LOG_FILE, Bun.file(LOG_FILE).text().then(t => t + line + '\n').catch(() => line + '\n'));
}

function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len - 1) + '…' : s;
}

// ─── Signal computation ──────────────────────────────────────────────────────
function computeSignal(game: SportGame, espnSignal: Signal | null): Signal {
  if (espnSignal) return espnSignal;

  const diff = game.homeTeam.score - game.awayTeam.score;

  if (game.sport === 'ncaab') {
    const prob = calcNcaabWinProb({
      scoreDiff: diff,
      half: game.period <= 1 ? 1 : 2,
      timeLeft: game.clock || '20:00',
    }, true);
    return { trueProb: prob, confidence: 0.70, source: 'ncaab-logistic', timestamp: Date.now() };
  }

  if (game.sport === 'nhl') {
    const prob = calcNhlWinProb({
      scoreDiff: diff,
      period: game.period,
      timeLeft: game.clock || '20:00',
    }, true);
    return { trueProb: prob, confidence: 0.70, source: 'nhl-logistic', timestamp: Date.now() };
  }

  const prob = calcNbaWinProb({
    scoreDiff: diff,
    period: game.period,
    timeLeft: game.clock || '12:00',
  }, true);
  return { trueProb: prob, confidence: 0.70, source: 'nba-logistic', timestamp: Date.now() };
}

// ─── Main loop ───────────────────────────────────────────────────────────────
async function run() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  POLYARB LIVE SIM  │  $50 USDC  │  KALSHI  │  NBA+NCAAB+NHL ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log();

  const espn = new EspnClient();
  const kalshi = new KalshiClient();

  // Fetch Kalshi game markets
  log('Fetching Kalshi game markets...');
  const [nbaKalshi, ncaabKalshi, nhlKalshi] = await Promise.all([
    kalshi.getGameMarkets('nba'),
    kalshi.getGameMarkets('ncaab'),
    kalshi.getGameMarkets('nhl'),
  ]);

  let kalshiMarkets: { sport: 'nba' | 'ncaab' | 'nhl'; markets: KalshiMarket[] }[] = [
    { sport: 'nba', markets: nbaKalshi },
    { sport: 'ncaab', markets: ncaabKalshi },
    { sport: 'nhl', markets: nhlKalshi },
  ];

  log(`Found ${nbaKalshi.length} NBA + ${ncaabKalshi.length} NCAAB + ${nhlKalshi.length} NHL Kalshi markets`);

  // Show some markets
  for (const { sport, markets } of kalshiMarkets) {
    for (const m of markets.slice(0, 3)) {
      log(`  ${sport.toUpperCase()}: "${truncate(m.title, 50)}" YES=$${(m.yesAsk / 100).toFixed(2)} NO=$${(m.noAsk / 100).toFixed(2)} vol=$${m.volume.toLocaleString()}`);
    }
  }
  console.log();

  log('Starting live polling NOW...');
  console.log();

  let consecutiveEmpty = 0;

  for (let poll = 1; poll <= MAX_POLLS; poll++) {
    try {
      const [nbaLive, ncaabLive, nhlLive] = await Promise.all([
        espn.getLiveGames('nba'),
        espn.getLiveGames('ncaab'),
        espn.getLiveGames('nhl'),
      ]);

      const totalLive = nbaLive.length + ncaabLive.length + nhlLive.length;

      if (totalLive === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 5) {
          log('No live games for 10 minutes. Checking if all games ended...');
          const [allNba, allNcaab, allNhl] = await Promise.all([
            fetchAllGames(espn, 'nba'),
            fetchAllGames(espn, 'ncaab'),
            fetchAllGames(espn, 'nhl'),
          ]);
          const allGames = [...allNba, ...allNcaab, ...allNhl];
          const finals = allGames.filter(g => g.status === 'final');
          const scheduled = allGames.filter(g => g.status === 'scheduled');
          if (finals.length > 0 && scheduled.length === 0) {
            log(`All games finished (${finals.length} final). Stopping.`);
            break;
          }
          log(`${finals.length} final, ${scheduled.length} scheduled — continuing...`);
          consecutiveEmpty = 0;
        } else {
          if (poll % 3 === 0) log(`Poll #${poll} — no live games, waiting...`);
        }
      } else {
        consecutiveEmpty = 0;
        log(`─── Poll #${poll} | ${nbaLive.length} NBA + ${ncaabLive.length} NCAAB + ${nhlLive.length} NHL live ───`);

        // Build work items for all live games
        const allGames: Array<{ game: SportGame; sport: 'nba' | 'ncaab' | 'nhl'; sportLabel: string }> = [
          ...nbaLive.map(g => ({ game: g, sport: 'nba' as const, sportLabel: 'NBA' })),
          ...ncaabLive.map(g => ({ game: g, sport: 'ncaab' as const, sportLabel: 'NCAAB' })),
          ...nhlLive.map(g => ({ game: g, sport: 'nhl' as const, sportLabel: 'NHL' })),
        ];

        for (const { game, sport, sportLabel } of allGames) {
          // Get ESPN predictor, fall back to logistic model
          const predictor = await espn.getPredictor(game.sport, game.id);
          const signal = computeSignal(game, predictor);

          const periodLabel = game.sport === 'ncaab' ? `H${game.period}` : game.sport === 'nhl' ? `P${game.period}` : `Q${game.period}`;
          const gameStr = `${game.awayTeam.abbreviation} ${game.awayTeam.score} @ ${game.homeTeam.abbreviation} ${game.homeTeam.score} ${periodLabel} ${game.clock}`;
          log(`  ${sportLabel} | ${gameStr} | homeWP=${(signal.trueProb * 100).toFixed(1)}% [${signal.source}]`);

          // Find matching Kalshi market
          const sportMarkets = kalshiMarkets.find(s => s.sport === sport)?.markets ?? [];
          const km = kalshi.matchGameToMarket(game, sportMarkets);
          if (!km) {
            log(`    No matching Kalshi market`);
            continue;
          }

          // Convert to Market type for edge calculation
          const market = kalshi.toMarket(km, sport);

          const { side, edge } = calcEdge(signal.trueProb, market.yesPrice, market.noPrice);
          const price = side === 'YES' ? market.yesPrice : market.noPrice;
          const trueP = side === 'YES' ? signal.trueProb : 1 - signal.trueProb;
          const size = kellySize(trueP, price);

          log(`    Kalshi: "${truncate(km.title, 45)}" YES=$${(km.yesAsk / 100).toFixed(2)} NO=$${(km.noAsk / 100).toFixed(2)} vol=$${km.volume.toLocaleString()}`);
          log(`    Edge: ${side} ${(edge * 100).toFixed(1)}% | size=$${size.toFixed(2)}`);

          // Check cooldown
          const lastTrade = cooldowns.get(market.id) ?? 0;
          const cooledDown = Date.now() - lastTrade > COOLDOWN_MS;

          // Check per-market exposure cap
          const mktExp = marketExposure.get(market.id) ?? 0;
          const withinMarketCap = mktExp + size <= MAX_PER_MARKET;

          if (edge >= MIN_EDGE && size >= 2 && cooledDown && withinMarketCap && totalExposure + size <= balance) {
            // Check orderbook liquidity before executing
            const ob = await kalshi.getOrderBook(km.ticker);
            let liqInfo: SimTrade['liquidity'];

            if (ob) {
              const priceCents = Math.round(price * 100);
              const liq = kalshi.checkLiquidity(ob, side === 'YES' ? 'yes' : 'no', priceCents, size);
              liqInfo = { avgPrice: liq.avgPrice, availableQty: liq.availableQty };

              if (!liq.canFill) {
                log(`    --- Insufficient liquidity (${liq.availableQty} contracts available)`);
                continue;
              }
              log(`    Liquidity OK: ${liq.availableQty} contracts @ avg $${liq.avgPrice.toFixed(2)}`);
            }

            trades.push({
              poll, time: new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' }),
              sport: sportLabel, game: gameStr, market: km.title, side, price, sizeUsd: size,
              edge, trueProb: signal.trueProb, source: signal.source, liquidity: liqInfo,
            });
            totalExposure += size;
            marketExposure.set(market.id, mktExp + size);
            cooldowns.set(market.id, Date.now());
            log(`    >>> TRADE #${trades.length}: BUY ${side} @ $${price.toFixed(2)} for $${size.toFixed(2)} | mkt_exp=$${(mktExp + size).toFixed(2)}/${MAX_PER_MARKET} | total=$${totalExposure.toFixed(2)}/${balance.toFixed(2)}`);
          } else if (!cooledDown) {
            log(`    --- Cooldown (${Math.round((COOLDOWN_MS - (Date.now() - lastTrade)) / 1000)}s left)`);
          } else if (!withinMarketCap) {
            log(`    --- Market cap reached ($${mktExp.toFixed(2)}/$${MAX_PER_MARKET})`);
          } else if (edge < MIN_EDGE) {
            log(`    --- Edge too small (${(edge * 100).toFixed(1)}% < ${(MIN_EDGE * 100).toFixed(0)}%)`);
          } else {
            log(`    --- Size too small or insufficient balance`);
          }
        }
      }
    } catch (err) {
      log(`Poll #${poll} error: ${err}`);
    }

    // Refresh Kalshi markets every 10 polls (~20 min)
    if (poll % 10 === 0) {
      try {
        const [freshNba, freshNcaab, freshNhl] = await Promise.all([
          kalshi.getGameMarkets('nba'),
          kalshi.getGameMarkets('ncaab'),
          kalshi.getGameMarkets('nhl'),
        ]);
        kalshiMarkets = [
          { sport: 'nba', markets: freshNba },
          { sport: 'ncaab', markets: freshNcaab },
          { sport: 'nhl', markets: freshNhl },
        ];
        log(`Refreshed Kalshi markets: ${freshNba.length} NBA + ${freshNcaab.length} NCAAB + ${freshNhl.length} NHL`);
      } catch {}
    }

    await Bun.sleep(POLL_INTERVAL_MS);
  }

  // ─── Final summary ─────────────────────────────────────────────────────────
  printSummary();
}

function printSummary() {
  console.log();
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                    SESSION COMPLETE                           ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');

  if (trades.length === 0) {
    console.log('║  No trades were triggered during this session.               ║');
    console.log(`║  Starting balance:  $${STARTING_BALANCE.toFixed(2).padStart(8)} USDC                       ║`);
    console.log(`║  Final balance:     $${STARTING_BALANCE.toFixed(2).padStart(8)} USDC                       ║`);
  } else {
    console.log('║                                                              ║');
    console.log('║  Trades executed (dry-run):                                  ║');
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i];
      const line = `  #${i + 1} ${t.sport.padEnd(5)} ${t.time} | ${t.side} @ $${t.price.toFixed(2)} | $${t.sizeUsd.toFixed(2)} | edge=${(t.edge * 100).toFixed(1)}%`;
      console.log(`║${line.padEnd(62)}║`);
    }
    console.log('║                                                              ║');

    // Monte Carlo outcomes
    let simBalance = STARTING_BALANCE;
    let wins = 0;
    console.log('║  Monte Carlo outcome simulation:                             ║');
    for (const t of trades) {
      const p = t.side === 'YES' ? t.trueProb : 1 - t.trueProb;
      const won = Math.random() < p;
      if (won) {
        wins++;
        simBalance += t.sizeUsd * ((1 / t.price) - 1);
      } else {
        simBalance -= t.sizeUsd;
      }
      const result = won ? 'WIN ' : 'LOSS';
      const pnl = won ? `+$${(t.sizeUsd * ((1 / t.price) - 1)).toFixed(2)}` : `-$${t.sizeUsd.toFixed(2)}`;
      console.log(`║    ${result} ${pnl.padStart(10)} | ${t.sport.padEnd(5)} ${truncate(t.game, 30).padEnd(30)}║`);
    }

    const totalPnl = simBalance - STARTING_BALANCE;
    console.log('║                                                              ║');
    console.log(`║  Starting balance:    $${STARTING_BALANCE.toFixed(2).padStart(8)} USDC                       ║`);
    console.log(`║  Total exposure:      $${totalExposure.toFixed(2).padStart(8)}                              ║`);
    console.log(`║  Unique markets:      ${String(marketExposure.size).padStart(8)}                              ║`);
    console.log(`║  Win/Loss:            ${String(wins).padStart(3)}W / ${String(trades.length - wins)}L                             ║`);
    console.log(`║  Simulated P&L:      ${(totalPnl >= 0 ? '+' : '')}$${totalPnl.toFixed(2).padStart(8)}                              ║`);
    console.log(`║  Final balance:       $${simBalance.toFixed(2).padStart(8)} USDC                       ║`);
    console.log(`║  Return:              ${((simBalance / STARTING_BALANCE - 1) * 100).toFixed(1).padStart(7)}%                              ║`);
  }

  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Log saved to: ${LOG_FILE}`);
}

// Graceful shutdown — print summary on SIGINT/SIGTERM
process.on('SIGINT', () => { printSummary(); process.exit(0); });
process.on('SIGTERM', () => { printSummary(); process.exit(0); });

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function fetchAllGames(espn: EspnClient, sport: 'nba' | 'ncaab' | 'nhl'): Promise<SportGame[]> {
  const paths: Record<string, string> = {
    nba: 'basketball/nba',
    ncaab: 'basketball/mens-college-basketball',
    nhl: 'hockey/nhl',
  };
  try {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${paths[sport]}/scoreboard`);
    const data = (await res.json()) as any;
    return (data.events ?? []).map((ev: any) => {
      const comp = ev.competitions?.[0];
      if (!comp) return null;
      const home = comp.competitors.find((c: any) => c.homeAway === 'home');
      const away = comp.competitors.find((c: any) => c.homeAway === 'away');
      const state = comp.status?.type?.state;
      return {
        id: ev.id, sport: sport as Sport,
        homeTeam: { name: home?.team?.displayName ?? '', abbreviation: home?.team?.abbreviation ?? '', score: parseInt(home?.score ?? '0') },
        awayTeam: { name: away?.team?.displayName ?? '', abbreviation: away?.team?.abbreviation ?? '', score: parseInt(away?.score ?? '0') },
        period: comp.status?.period ?? 0, clock: comp.status?.displayClock ?? '',
        status: state === 'post' ? 'final' as const : state === 'in' ? 'in_progress' as const : 'scheduled' as const,
      };
    }).filter(Boolean) as SportGame[];
  } catch { return []; }
}

run().catch(console.error);
