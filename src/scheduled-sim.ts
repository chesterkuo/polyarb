/**
 * Scheduled dry-run simulation for tonight's NBA games.
 * Polls ESPN every 2 minutes during live games, runs signal pipeline
 * with $50 USDC, tracks cumulative P&L across all polls.
 *
 * Usage: bun run src/scheduled-sim.ts
 */

import { CONFIG } from './config';
import type { Market, Signal, Side, Sport, SportGame } from './types';
import { GammaScanner } from './data/polymarket-gamma';
import { EspnClient } from './data/espn/espn-client';
import { PinnacleClient } from './data/pinnacle-client';
import { calcEdge } from './signals/edge-calculator';
import { computeAnchoredSignal, isFuturesMarket, isGameMarket } from './signals/market-anchored-wp';

// ─── Config ──────────────────────────────────────────────────────────────────
const STARTING_BALANCE = 50;
const MAX_POSITION     = 12.50;
const KELLY_FRACTION   = 0.25;
const MIN_EDGE         = CONFIG.minEdge;
const POLL_INTERVAL_MS = 2 * 60 * 1000;   // Poll every 2 minutes
const COOLDOWN_MS      = POLL_INTERVAL_MS; // One trade per market per poll cycle
const MAX_PRICE        = 0.78;             // Don't buy above $0.78 — poor risk/reward
const MAX_POLLS        = 90;               // Run for up to 3 hours
const LOG_FILE         = 'data/logs/sim-' + new Date().toISOString().split('T')[0] + '.log';

// ─── State ───────────────────────────────────────────────────────────────────
interface SimTrade {
  poll: number;
  time: string;
  game: string;
  market: string;
  side: Side;
  price: number;
  sizeUsd: number;
  edge: number;
  trueProb: number;
  source: string;
}

const trades: SimTrade[] = [];
const cooldowns = new Map<string, number>(); // marketId -> timestamp
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
  // Also append to log file
  Bun.write(LOG_FILE, Bun.file(LOG_FILE).text().then(t => t + line + '\n').catch(() => line + '\n'));
}

function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len - 1) + '…' : s;
}

// ─── Main loop ───────────────────────────────────────────────────────────────
async function run() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  POLYARB SCHEDULED SIMULATION  │  $50 USDC  │  NBA Tonight  ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log();

  // Wait for first game
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  // Target: 7:05 PM ET (5 min after first tip-off to ensure scores are updating)
  // 7:05 PM ET = 00:05 UTC next day
  const targetHourUTC = 0;  // midnight UTC = 7 PM ET
  const targetMinUTC = 5;

  const target = new Date(today + 'T00:00:00Z');
  target.setUTCDate(target.getUTCDate() + 1); // tomorrow UTC = tonight ET
  target.setUTCHours(targetHourUTC, targetMinUTC, 0, 0);

  const waitMs = target.getTime() - now.getTime();

  if (waitMs > 0) {
    const waitMin = Math.round(waitMs / 60000);
    log(`Waiting ${waitMin} minutes until first tip-off (~7:05 PM ET)...`);
    log(`Target: ${target.toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`);
    log(`Current: ${now.toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`);
    console.log();
    log('Sleeping... (will wake up for game time)');
    console.log();
    await Bun.sleep(waitMs);
  }

  log('Game time! Starting live polling...');
  console.log();

  const espn = new EspnClient();
  const gamma = new GammaScanner();

  // Pre-fetch markets once
  log('Fetching Polymarket markets...');
  const nbaMarkets = await gamma.getNbaMarkets();
  const pricedMarkets = nbaMarkets.filter(m => m.yesPrice > 0.01 && m.yesPrice < 0.99);
  log(`Found ${pricedMarkets.length} NBA markets with live prices`);
  console.log();

  // Poll loop
  for (let poll = 1; poll <= MAX_POLLS; poll++) {
    try {
      const liveGames = await espn.getLiveGames('nba');

      if (liveGames.length === 0 && poll > 5) {
        // If no live games after several polls, check if games ended
        log('No live NBA games detected. Checking if games have ended...');
        const allGames = await fetchAllTodayGames(espn);
        const finished = allGames.filter(g => g.status === 'final');
        if (finished.length > 0 && liveGames.length === 0) {
          log(`All games appear to be over (${finished.length} final). Stopping.`);
          break;
        }
        log('Games may not have started yet. Waiting...');
      }

      if (liveGames.length > 0) {
        log(`─── Poll #${poll} | ${liveGames.length} live game(s) ───`);

        for (const game of liveGames) {
          // Find matching market FIRST so we can anchor signal to market price
          const market = findGameMarket(game, pricedMarkets);
          if (!market) {
            const gameStr = `${game.awayTeam.abbreviation} ${game.awayTeam.score} @ ${game.homeTeam.abbreviation} ${game.homeTeam.score} Q${game.period} ${game.clock}`;
            log(`  ${gameStr} | No matching market`);
            continue;
          }

          const predictor = await espn.getPredictor('nba', game.id);
          const signal = computeAnchoredSignal(game, market.yesPrice, predictor);

          const gameStr = `${game.awayTeam.abbreviation} ${game.awayTeam.score} @ ${game.homeTeam.abbreviation} ${game.homeTeam.score} Q${game.period} ${game.clock}`;
          log(`  ${gameStr} | yesProb=${(signal.trueProb * 100).toFixed(1)}% [${signal.source}]`);

          const { side, edge } = calcEdge(signal.trueProb, market.yesPrice, market.noPrice);
          const price = side === 'YES' ? market.yesPrice : market.noPrice;
          const trueP = side === 'YES' ? signal.trueProb : 1 - signal.trueProb;
          const size = kellySize(trueP, price);

          log(`    Market: "${truncate(market.question, 50)}" YES=$${market.yesPrice.toFixed(2)} NO=$${market.noPrice.toFixed(2)}`);
          log(`    Edge: ${side} ${(edge * 100).toFixed(1)}% | size=$${size.toFixed(2)}`);

          // Check cooldown (one trade per market per poll cycle)
          const lastTrade = cooldowns.get(market.id) ?? 0;
          const cooledDown = Date.now() - lastTrade > COOLDOWN_MS;

          if (price > MAX_PRICE) {
            log(`    --- Price too high ($${price.toFixed(2)} > $${MAX_PRICE}) — poor risk/reward`);
          } else if (edge >= MIN_EDGE && size >= 2 && cooledDown && totalExposure + size <= balance) {
            trades.push({
              poll, time: new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' }),
              game: gameStr, market: market.question, side, price, sizeUsd: size,
              edge, trueProb: signal.trueProb, source: signal.source,
            });
            totalExposure += size;
            cooldowns.set(market.id, Date.now());
            log(`    >>> TRADE #${trades.length}: BUY ${side} @ $${price.toFixed(2)} for $${size.toFixed(2)} | exposure=$${totalExposure.toFixed(2)}/${balance.toFixed(2)}`);
          } else if (!cooledDown) {
            log(`    --- Cooldown`);
          } else if (edge < MIN_EDGE) {
            log(`    --- Edge too small (${(edge * 100).toFixed(1)}% < 8%)`);
          } else {
            log(`    --- Size too small or insufficient balance`);
          }
        }
      } else {
        if (poll % 5 === 0) log(`Poll #${poll} — no live games yet, waiting...`);
      }
    } catch (err) {
      log(`Poll #${poll} error: ${err}`);
    }

    // Refresh markets every 10 polls (~20 min)
    if (poll % 10 === 0) {
      try {
        const fresh = await gamma.getNbaMarkets();
        const freshPriced = fresh.filter(m => m.yesPrice > 0.01 && m.yesPrice < 0.99);
        pricedMarkets.length = 0;
        pricedMarkets.push(...freshPriced);
        log(`Refreshed markets: ${freshPriced.length} priced`);
      } catch {}
    }

    await Bun.sleep(POLL_INTERVAL_MS);
  }

  // ─── Final summary ─────────────────────────────────────────────────────────
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
      const line = `  #${i + 1} ${t.time} | ${t.side} @ $${t.price.toFixed(2)} | $${t.sizeUsd.toFixed(2)} | edge=${(t.edge * 100).toFixed(1)}%`;
      console.log(`║${line.padEnd(62)}║`);
    }
    console.log('║                                                              ║');

    // Simulate outcomes for final P&L
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
      console.log(`║    ${result} ${pnl.padStart(10)} | ${truncate(t.game, 35).padEnd(35)}   ║`);
    }

    const totalPnl = simBalance - STARTING_BALANCE;
    console.log('║                                                              ║');
    console.log(`║  Starting balance:    $${STARTING_BALANCE.toFixed(2).padStart(8)} USDC                       ║`);
    console.log(`║  Total exposure:      $${totalExposure.toFixed(2).padStart(8)}                              ║`);
    console.log(`║  Win/Loss:            ${String(wins).padStart(3)}W / ${String(trades.length - wins)}L                             ║`);
    console.log(`║  Simulated P&L:      ${(totalPnl >= 0 ? '+' : '')}$${totalPnl.toFixed(2).padStart(8)}                              ║`);
    console.log(`║  Final balance:       $${simBalance.toFixed(2).padStart(8)} USDC                       ║`);
    console.log(`║  Return:              ${((simBalance / STARTING_BALANCE - 1) * 100).toFixed(1).padStart(7)}%                              ║`);
  }

  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Log saved to: ${LOG_FILE}`);
}

// ─── Helpers (futures filter + game check imported from market-anchored-wp) ──
function findGameMarket(game: SportGame, markets: Market[]): Market | null {
  const hName = game.homeTeam.name.toLowerCase();
  const aName = game.awayTeam.name.toLowerCase();
  const hAbbr = game.homeTeam.abbreviation.toLowerCase();
  const aAbbr = game.awayTeam.abbreviation.toLowerCase();

  for (const m of markets) {
    if (isFuturesMarket(m.question)) continue;
    if (!isGameMarket(m.question)) continue;
    const q = m.question.toLowerCase();
    if ((q.includes(hName) || q.includes(hAbbr)) &&
        (q.includes(aName) || q.includes(aAbbr))) {
      return m;
    }
  }
  return null;
}

async function fetchAllTodayGames(espn: EspnClient): Promise<SportGame[]> {
  // ESPN scoreboard returns all today's games including final
  try {
    const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard');
    const data = (await res.json()) as any;
    return (data.events ?? []).map((ev: any) => {
      const comp = ev.competitions?.[0];
      if (!comp) return null;
      const home = comp.competitors.find((c: any) => c.homeAway === 'home');
      const away = comp.competitors.find((c: any) => c.homeAway === 'away');
      const state = comp.status?.type?.state;
      return {
        id: ev.id,
        sport: 'nba' as Sport,
        homeTeam: { name: home?.team?.displayName ?? '', abbreviation: home?.team?.abbreviation ?? '', score: parseInt(home?.score ?? '0') },
        awayTeam: { name: away?.team?.displayName ?? '', abbreviation: away?.team?.abbreviation ?? '', score: parseInt(away?.score ?? '0') },
        period: comp.status?.period ?? 0,
        clock: comp.status?.displayClock ?? '',
        status: state === 'post' ? 'final' as const : state === 'in' ? 'in_progress' as const : 'scheduled' as const,
      };
    }).filter(Boolean) as SportGame[];
  } catch {
    return [];
  }
}

run().catch(console.error);
