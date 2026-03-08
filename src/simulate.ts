/**
 * One-shot dry-run simulation with $50 USDC.
 * Connects to real Polymarket Gamma + ESPN APIs, runs signal pipeline,
 * simulates trades, and prints a wallet summary.
 *
 * If no live games are available, seeds synthetic games to show the
 * full pipeline in action.
 *
 * Usage: bun run src/simulate.ts
 */

import { CONFIG } from './config';
import type { Market, Signal, Side, Sport, SportGame } from './types';
import { GammaScanner } from './data/polymarket-gamma';
import { EspnClient } from './data/espn/espn-client';
import { NhlClient } from './data/nhl/nhl-client';
import { MarketMatcher } from './data/market-matcher';
import { calcEdge, calcKellySize } from './signals/edge-calculator';
import { calcNbaWinProb, calcNcaabWinProb } from './signals/wp-models/nba-wp';
import { calcNhlWinProb } from './signals/wp-models/nhl-wp';
import { parseClockToMinutes } from './signals/wp-models/parse-clock';
import { isFuturesMarket, isGameMarket } from './signals/market-anchored-wp';
import teamNamesData from '../data/team-names.json';

// ─── Simulation constants ────────────────────────────────────────────────────
const STARTING_BALANCE = 50;
const MAX_POSITION     = 12.50;
const KELLY_FRACTION   = 0.25;
const MIN_EDGE         = CONFIG.minEdge; // 8%
const NUM_SIM_ROUNDS   = 10;            // Simulate 10 poll cycles

// ─── Types ───────────────────────────────────────────────────────────────────
interface SimTrade {
  round: number;
  sport: string;
  marketQ: string;
  side: Side;
  price: number;
  sizeUsd: number;
  edge: number;
  trueProb: number;
  confidence: number;
  source: string;
  outcome: 'win' | 'loss';
  pnl: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function kellySize(trueProb: number, price: number): number {
  const b = (1 / price) - 1;
  if (b <= 0) return 0;
  const kelly = Math.max(0, (b * trueProb - (1 - trueProb)) / b);
  const size = Math.min(MAX_POSITION, kelly * KELLY_FRACTION * STARTING_BALANCE);
  return size < 2 ? 0 : size;
}

function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len - 1) + '…' : s;
}

function pad(s: string, len: number): string { return s.padEnd(len); }

// ─── Synthetic game generator (when no live games) ──────────────────────────
function generateSyntheticGames(): { nba: SportGame[]; ncaab: SportGame[]; nhl: SportGame[] } {
  // Generate realistic mid-game scenarios
  return {
    nba: [
      { id: 'sim-nba-1', sport: 'nba', homeTeam: { name: 'Oklahoma City Thunder', abbreviation: 'OKC', score: 88 }, awayTeam: { name: 'Denver Nuggets', abbreviation: 'DEN', score: 74 }, period: 3, clock: '4:22', status: 'in_progress' },
      { id: 'sim-nba-2', sport: 'nba', homeTeam: { name: 'Cleveland Cavaliers', abbreviation: 'CLE', score: 52 }, awayTeam: { name: 'New York Knicks', abbreviation: 'NYK', score: 55 }, period: 2, clock: '8:10', status: 'in_progress' },
      { id: 'sim-nba-3', sport: 'nba', homeTeam: { name: 'Houston Rockets', abbreviation: 'HOU', score: 102 }, awayTeam: { name: 'Boston Celtics', abbreviation: 'BOS', score: 95 }, period: 4, clock: '2:45', status: 'in_progress' },
    ],
    ncaab: [
      { id: 'sim-ncaab-1', sport: 'ncaab', homeTeam: { name: 'Florida Gators', abbreviation: 'FLA', score: 38 }, awayTeam: { name: 'Alabama Crimson Tide', abbreviation: 'ALA', score: 30 }, period: 2, clock: '14:33', status: 'in_progress' },
      { id: 'sim-ncaab-2', sport: 'ncaab', homeTeam: { name: 'Duke Blue Devils', abbreviation: 'DUKE', score: 62 }, awayTeam: { name: 'Michigan State Spartans', abbreviation: 'MSU', score: 55 }, period: 2, clock: '5:10', status: 'in_progress' },
    ],
    nhl: [
      { id: 'sim-nhl-1', sport: 'nhl', homeTeam: { name: 'Carolina Hurricanes', abbreviation: 'CAR', score: 3 }, awayTeam: { name: 'Dallas Stars', abbreviation: 'DAL', score: 1 }, period: 2, clock: '8:15', status: 'in_progress' },
      { id: 'sim-nhl-2', sport: 'nhl', homeTeam: { name: 'Florida Panthers', abbreviation: 'FLA', score: 2 }, awayTeam: { name: 'Edmonton Oilers', abbreviation: 'EDM', score: 2 }, period: 3, clock: '12:00', status: 'in_progress' },
    ],
  };
}

// ─── Match game to Polymarket market (futures filter + game check from market-anchored-wp) ──
function findMarket(game: SportGame, markets: Market[]): Market | null {
  const hAbbr = game.homeTeam.abbreviation.toLowerCase();
  const aAbbr = game.awayTeam.abbreviation.toLowerCase();
  const hName = game.homeTeam.name.toLowerCase();
  const aName = game.awayTeam.name.toLowerCase();

  for (const m of markets) {
    if (isFuturesMarket(m.question)) continue;
    if (!isGameMarket(m.question)) continue;
    if (m.yesPrice <= 0.01 || m.yesPrice >= 0.99) continue;
    const q = m.question.toLowerCase();
    const homeMatch = q.includes(hName) || q.includes(hAbbr);
    const awayMatch = q.includes(aName) || q.includes(aAbbr);
    if (homeMatch && awayMatch) return m;
  }
  return null;
}

// ─── Main simulation ─────────────────────────────────────────────────────────
async function simulate() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  POLYARB DRY-RUN SIMULATION  │  Starting balance: $50 USDC  ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log();

  // 1. Fetch real markets from Polymarket Gamma
  console.log('[1/5] Scanning Polymarket Gamma for active markets...');
  const gamma = new GammaScanner();
  const [esportsMarkets, nbaMarkets, ncaabMarkets, nhlMarkets] = await Promise.all([
    gamma.getEsportsMarkets(),
    gamma.getNbaMarkets(),
    gamma.getNcaabMarkets(),
    gamma.getNhlMarkets(),
  ]);

  const nbaPriced = nbaMarkets.filter(m => m.yesPrice > 0.01 && m.yesPrice < 0.99);
  const ncaabPriced = ncaabMarkets.filter(m => m.yesPrice > 0.01 && m.yesPrice < 0.99);
  const nhlPriced = nhlMarkets.filter(m => m.yesPrice > 0.01 && m.yesPrice < 0.99);

  console.log(`      Total: ${esportsMarkets.length} esports, ${nbaMarkets.length} NBA, ${ncaabMarkets.length} NCAAB, ${nhlMarkets.length} NHL`);
  console.log(`      With live prices: ${nbaPriced.length} NBA, ${ncaabPriced.length} NCAAB, ${nhlPriced.length} NHL`);
  console.log();

  // 2. Fetch live games from ESPN
  console.log('[2/5] Fetching live games from ESPN + NHL API...');
  const espn = new EspnClient();
  const nhlClient = new NhlClient();

  const [nbaLive, ncaabLive, nhlLive] = await Promise.all([
    espn.getLiveGames('nba'),
    espn.getLiveGames('ncaab'),
    espn.getLiveGames('nhl'),
  ]);

  const totalLive = nbaLive.length + ncaabLive.length + nhlLive.length;
  console.log(`      Live games: ${nbaLive.length} NBA, ${ncaabLive.length} NCAAB, ${nhlLive.length} NHL`);

  let nbaGames = nbaLive;
  let ncaabGames = ncaabLive;
  let nhlGames = nhlLive;
  let synthetic = false;

  if (totalLive === 0) {
    console.log('      No live games right now — seeding synthetic in-progress games.');
    const syn = generateSyntheticGames();
    nbaGames = syn.nba;
    ncaabGames = syn.ncaab;
    nhlGames = syn.nhl;
    synthetic = true;
  }
  console.log();

  // 3. Show all real Polymarket markets with prices
  console.log('[3/5] Top Polymarket sports markets (real prices from Gamma API):');
  console.log();
  printMarketTable('NBA', nbaPriced.slice(0, 6));
  printMarketTable('NCAAB', ncaabPriced.slice(0, 4));
  printMarketTable('NHL', nhlPriced.slice(0, 4));

  // 4. Compute signals for all live/synthetic games
  console.log(`[4/5] Running signal pipeline (${NUM_SIM_ROUNDS} simulated poll rounds)...`);
  console.log();

  const allTrades: SimTrade[] = [];
  let balance = STARTING_BALANCE;
  let totalExposure = 0;
  const cooldowns = new Set<string>();

  for (let round = 1; round <= NUM_SIM_ROUNDS; round++) {
    // Simulate time passing — scores change slightly each round
    if (round > 1) {
      for (const g of nbaGames) mutateScore(g, 'nba');
      for (const g of ncaabGames) mutateScore(g, 'ncaab');
      for (const g of nhlGames) mutateScore(g, 'nhl');
    }

    console.log(`  ── Round ${round}/${NUM_SIM_ROUNDS} ──────────────────────────────────────────`);

    // Process each sport
    processGames('NBA', nbaGames, nbaPriced, 'nba', round, allTrades, cooldowns);
    processGames('NCAAB', ncaabGames, ncaabPriced, 'ncaab', round, allTrades, cooldowns);
    processGames('NHL', nhlGames, nhlPriced, 'nhl', round, allTrades, cooldowns);
    console.log();
  }

  // 5. Resolve trades and compute P&L
  console.log('[5/5] Resolving trades & computing P&L...');
  console.log();

  for (const trade of allTrades) {
    const p = trade.side === 'YES' ? trade.trueProb : 1 - trade.trueProb;
    trade.outcome = Math.random() < p ? 'win' : 'loss';
    if (trade.outcome === 'win') {
      trade.pnl = trade.sizeUsd * ((1 / trade.price) - 1);
    } else {
      trade.pnl = -trade.sizeUsd;
    }
    balance += trade.pnl;
  }

  if (allTrades.length > 0) {
    printTradeTable(allTrades);
  } else {
    console.log('  No trades triggered — all edges < 8% or size too small.');
    console.log();
    console.log('  Showing signal scan for all games:');
    for (const g of [...nbaGames, ...ncaabGames, ...nhlGames]) {
      const sig = computeSignal(g);
      const market = findMarket(g, [...nbaPriced, ...ncaabPriced, ...nhlPriced]);
      let edgeStr = 'no market';
      if (market) {
        const { side, edge } = calcEdge(sig.trueProb, market.yesPrice, market.noPrice);
        edgeStr = `${side} edge=${(edge * 100).toFixed(1)}%${edge >= MIN_EDGE ? ' !!!' : ''}`;
      }
      console.log(`    ${g.sport.toUpperCase().padEnd(5)} | ${g.awayTeam.abbreviation} ${g.awayTeam.score} @ ${g.homeTeam.abbreviation} ${g.homeTeam.score} | P${g.period} ${g.clock} | yesProb=${(sig.trueProb * 100).toFixed(1)}% | ${edgeStr}`);
    }
  }

  // Final wallet summary
  const wins = allTrades.filter(t => t.outcome === 'win').length;
  const losses = allTrades.length - wins;
  const totalPnl = allTrades.reduce((s, t) => s + t.pnl, 0);
  const totalWagered = allTrades.reduce((s, t) => s + t.sizeUsd, 0);

  console.log();
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                      WALLET SUMMARY                          ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log(`║  Starting balance:    $${STARTING_BALANCE.toFixed(2).padStart(8)} USDC                       ║`);
  console.log(`║  Total wagered:       $${totalWagered.toFixed(2).padStart(8)}                              ║`);
  console.log(`║  Trades:              ${String(allTrades.length).padStart(8)}   (${wins}W / ${losses}L)                  ║`);
  console.log(`║  Total P&L:          ${(totalPnl >= 0 ? '+' : '')}$${totalPnl.toFixed(2).padStart(8)}                              ║`);
  console.log(`║  ─────────────────────────────────────────────────────────── ║`);
  console.log(`║  FINAL BALANCE:       $${balance.toFixed(2).padStart(8)} USDC                       ║`);
  console.log(`║  Return:              ${((balance / STARTING_BALANCE - 1) * 100).toFixed(1).padStart(7)}%                              ║`);
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  if (synthetic) {
    console.log();
    console.log('NOTE: Games were synthetic (no live games at time of run).');
    console.log('      Market prices are REAL from Polymarket Gamma API.');
    console.log('      Trade outcomes are Monte Carlo simulated from true probabilities.');
  }
}

// ─── Process games for a sport ──────────────────────────────────────────────
function processGames(
  label: string,
  games: SportGame[],
  markets: Market[],
  sport: Sport,
  round: number,
  trades: SimTrade[],
  cooldowns: Set<string>,
) {
  for (const game of games) {
    const signal = computeSignal(game);
    const market = findMarket(game, markets);

    console.log(`    ${label} | ${game.awayTeam.abbreviation} ${String(game.awayTeam.score).padStart(3)} @ ${game.homeTeam.abbreviation} ${String(game.homeTeam.score).padStart(3)} | P${game.period} ${game.clock.padEnd(5)} | yesProb=${(signal.trueProb * 100).toFixed(1).padStart(5)}% | ${signal.source}`);

    if (!market) {
      console.log(`           No matching market`);
      continue;
    }

    const { side, edge } = calcEdge(signal.trueProb, market.yesPrice, market.noPrice);
    const price = side === 'YES' ? market.yesPrice : market.noPrice;
    const trueP = side === 'YES' ? signal.trueProb : 1 - signal.trueProb;
    const size = kellySize(trueP, price);

    const mktStr = truncate(market.question, 45);
    console.log(`           Market: "${mktStr}" | YES=$${market.yesPrice.toFixed(2)} NO=$${market.noPrice.toFixed(2)}`);
    console.log(`           Edge: ${side} ${(edge * 100).toFixed(1)}% | kelly=$${size.toFixed(2)}`);

    if (edge >= MIN_EDGE && size >= 2 && !cooldowns.has(market.id)) {
      trades.push({
        round, sport: label, marketQ: market.question, side, price, sizeUsd: size,
        edge, trueProb: signal.trueProb, confidence: signal.confidence,
        source: signal.source, outcome: 'win', pnl: 0,
      });
      cooldowns.add(market.id);
      console.log(`           >>> TRADE #${trades.length}: BUY ${side} @ $${price.toFixed(2)} for $${size.toFixed(2)}`);
    } else if (cooldowns.has(market.id)) {
      console.log(`           --- Cooldown (already traded)`);
    } else {
      const reason = edge < MIN_EDGE ? `edge ${(edge*100).toFixed(1)}% < 8%` : `size $${size.toFixed(2)} < $2`;
      console.log(`           --- Skip (${reason})`);
    }
  }
}

// ─── Compute signal for a game ──────────────────────────────────────────────
function computeSignal(game: SportGame): Signal {
  const diff = game.homeTeam.score - game.awayTeam.score;
  if (game.sport === 'nba') {
    const prob = calcNbaWinProb({ scoreDiff: diff, period: game.period, timeLeft: game.clock || '12:00' }, true);
    return { trueProb: prob, confidence: 0.70, source: 'nba-logistic', timestamp: Date.now() };
  }
  if (game.sport === 'ncaab') {
    const prob = calcNcaabWinProb({ scoreDiff: diff, half: game.period <= 1 ? 1 : 2, timeLeft: game.clock || '20:00' }, true);
    return { trueProb: prob, confidence: 0.70, source: 'ncaab-logistic', timestamp: Date.now() };
  }
  const prob = calcNhlWinProb({ scoreDiff: diff, period: game.period, timeLeft: game.clock || '20:00' }, true);
  return { trueProb: prob, confidence: 0.70, source: 'nhl-logistic', timestamp: Date.now() };
}

// ─── Mutate scores to simulate time passing ─────────────────────────────────
function mutateScore(game: SportGame, sport: Sport): void {
  // Simulate scoring events between poll rounds
  const rand = Math.random();
  const currentMin = parseClockToMinutes(game.clock);
  if (sport === 'nhl') {
    // ~15% chance of a goal per round
    if (rand < 0.08) game.homeTeam.score++;
    else if (rand < 0.15) game.awayTeam.score++;
    // Advance clock by 30s
    const totalSec = Math.max(0, currentMin * 60 - 30);
    game.clock = `${Math.floor(totalSec / 60)}:${String(Math.round(totalSec % 60)).padStart(2, '0')}`;
  } else {
    // Basketball: ~40% chance someone scores per round
    const pts = Math.ceil(Math.random() * 3);
    if (rand < 0.2) game.homeTeam.score += pts;
    else if (rand < 0.4) game.awayTeam.score += pts;
    // Advance clock by 15s
    const totalSec = Math.max(0, currentMin * 60 - 15);
    game.clock = `${Math.floor(totalSec / 60)}:${String(Math.round(totalSec % 60)).padStart(2, '0')}`;
  }
}

// ─── Print helpers ───────────────────────────────────────────────────────────
function printMarketTable(label: string, markets: Market[]) {
  if (markets.length === 0) return;
  console.log(`  ${label}:`);
  for (const m of markets) {
    console.log(`    ${truncate(m.question, 55).padEnd(55)} YES=$${m.yesPrice.toFixed(2)} NO=$${m.noPrice.toFixed(2)}`);
  }
  console.log();
}

function printTradeTable(trades: SimTrade[]) {
  console.log('  ┌─────┬───────┬──────┬────────┬─────────┬───────┬─────────┬───────────┐');
  console.log('  │  #  │ Sport │ Side │ Price  │ Size    │ Edge  │ Result  │ P&L       │');
  console.log('  ├─────┼───────┼──────┼────────┼─────────┼───────┼─────────┼───────────┤');
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    const outcomeStr = t.outcome === 'win' ? ' WIN ' : ' LOSS';
    const pnlStr = (t.pnl >= 0 ? '+' : '') + '$' + t.pnl.toFixed(2);
    console.log(
      `  │ ${String(i + 1).padStart(3)} │ ${t.sport.padEnd(5)} │ ${t.side.padEnd(4)} │ $${t.price.toFixed(2).padStart(5)} │ $${t.sizeUsd.toFixed(2).padStart(6)} │ ${(t.edge*100).toFixed(1).padStart(4)}% │ ${outcomeStr.padEnd(7)} │ ${pnlStr.padStart(9)} │`
    );
  }
  console.log('  └─────┴───────┴──────┴────────┴─────────┴───────┴─────────┴───────────┘');
  console.log();
  for (const t of trades) {
    console.log(`  Trade: ${t.side} on "${truncate(t.marketQ, 60)}" [${t.source}]`);
  }
}

simulate().catch(console.error);
