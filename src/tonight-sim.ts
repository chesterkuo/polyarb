/**
 * Combined sim launcher — runs both Kalshi and Polymarket sims in parallel.
 * Auto-waits until ~7:05 PM ET, then polls ESPN for live games and matches
 * against both Kalshi game markets and Polymarket head-to-head markets.
 *
 * Usage: bun run src/tonight-sim.ts
 *
 * Each sim writes its own log file:
 *   data/logs/tonight-kalshi-YYYY-MM-DD.log
 *   data/logs/tonight-polymarket-YYYY-MM-DD.log
 */

import { CONFIG } from './config';
import type { Market, Signal, Side, Sport, SportGame } from './types';
import { KalshiClient, type KalshiMarket } from './data/kalshi/kalshi-client';
import { GammaScanner } from './data/polymarket-gamma';
import { EspnClient } from './data/espn/espn-client';
import { calcEdge } from './signals/edge-calculator';
import { computeAnchoredSignal, isFuturesMarket, FUTURES_KEYWORDS } from './signals/market-anchored-wp';

// ─── Config ──────────────────────────────────────────────────────────────────
const STARTING_BALANCE = 50;
const MAX_POSITION     = 10;
const KELLY_FRACTION   = 0.25;
const MIN_EDGE         = CONFIG.minEdge;
const POLL_INTERVAL_MS = 2 * 60 * 1000;
const COOLDOWN_MS      = 5 * 60 * 1000;
const MAX_PER_MARKET   = 15;
const MAX_YES_PRICE    = 0.65;    // YES risk/reward poor above $0.65 (max payout 1.54x)
const MAX_NO_PRICE     = 0.70;    // NO risk/reward poor above $0.70 (max payout 1.43x)
const MIN_EDGE_HIGH    = 0.12;    // 12% min edge when price > $0.65
const MAX_POLLS        = 120;

const TODAY = new Date().toISOString().split('T')[0];
const KALSHI_LOG  = `data/logs/tonight-kalshi-${TODAY}.log`;
const POLY_LOG    = `data/logs/tonight-polymarket-${TODAY}.log`;

// ─── Shared state per sim ────────────────────────────────────────────────────
interface SimTrade {
  poll: number;
  time: string;
  sport: string;
  game: string;
  gameId: string;
  market: string;
  side: Side;
  price: number;
  sizeUsd: number;
  edge: number;
  trueProb: number;
  source: string;
  platform: 'kalshi' | 'polymarket';
}

interface SimPosition {
  marketId: string;
  side: Side;
  tradeCount: number;
  totalCost: number;
  avgEntryPrice: number;
}

interface SimState {
  platform: 'kalshi' | 'polymarket';
  trades: SimTrade[];
  cooldowns: Map<string, number>;
  marketExposure: Map<string, number>;
  positions: Map<string, SimPosition>;
  balance: number;
  totalExposure: number;
  logFile: string;
}

function createState(platform: 'kalshi' | 'polymarket', logFile: string): SimState {
  return {
    platform,
    trades: [],
    cooldowns: new Map(),
    marketExposure: new Map(),
    positions: new Map(),
    balance: STARTING_BALANCE,
    totalExposure: 0,
    logFile,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function kellySize(trueProb: number, price: number, state: SimState): number {
  const b = (1 / price) - 1;
  if (b <= 0) return 0;
  const kelly = Math.max(0, (b * trueProb - (1 - trueProb)) / b);
  const remaining = state.balance - state.totalExposure;
  const size = Math.min(MAX_POSITION, kelly * KELLY_FRACTION * remaining);
  return size < 2 ? 0 : size;
}

async function log(prefix: string, msg: string, logFile: string) {
  const ts = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  });
  const line = `[${ts}] [${prefix}] ${msg}`;
  console.log(line);
  const existing = await Bun.file(logFile).text().catch(() => '');
  await Bun.write(logFile, existing + line + '\n');
}

function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len - 1) + '…' : s;
}

function computeSignal(game: SportGame, marketPrice: number, espnSignal: Signal | null): Signal {
  return computeAnchoredSignal(game, marketPrice, espnSignal);
}

/** Check falling-knife condition: price dropped >10% below avg entry, or too many trades already.
 *  Cap at 2 trades for expensive contracts (price > 0.60), 3 for cheaper ones.
 *  Compares same-side price to avoid false triggers when recommended side flips. */
function isFallingKnife(
  state: SimState, marketId: string, side: Side,
  yesPrice: number, noPrice: number,
): string | null {
  const pos = state.positions.get(marketId);
  if (!pos) return null;
  // Use the price for the POSITION's side, not the currently recommended side
  const samePrice = pos.side === 'YES' ? yesPrice : noPrice;
  const maxTrades = samePrice > 0.60 ? 2 : 3;
  if (pos.tradeCount >= maxTrades) return `already ${pos.tradeCount} trades on this market (max ${maxTrades} at $${samePrice.toFixed(2)})`;
  const dropPct = (pos.avgEntryPrice - samePrice) / pos.avgEntryPrice;
  if (dropPct > 0.10) return `price dropped ${(dropPct * 100).toFixed(0)}% below avg entry $${pos.avgEntryPrice.toFixed(2)}`;
  return null;
}

/** Update position tracking after a trade. */
function recordPosition(state: SimState, marketId: string, side: Side, price: number, size: number) {
  const pos = state.positions.get(marketId);
  if (pos) {
    const newTotal = pos.totalCost + size;
    pos.avgEntryPrice = (pos.avgEntryPrice * pos.totalCost + price * size) / newTotal;
    pos.totalCost = newTotal;
    pos.tradeCount++;
  } else {
    state.positions.set(marketId, { marketId, side, tradeCount: 1, totalCost: size, avgEntryPrice: price });
  }
}

function tryTrade(
  state: SimState,
  game: SportGame,
  signal: Signal,
  market: { id: string; question: string; yesPrice: number; noPrice: number },
  sportLabel: string,
  poll: number,
  prefix: string,
  gameId: string,
) {
  const { side, edge } = calcEdge(signal.trueProb, market.yesPrice, market.noPrice);
  const price = side === 'YES' ? market.yesPrice : market.noPrice;
  const trueP = side === 'YES' ? signal.trueProb : 1 - signal.trueProb;
  const size = kellySize(trueP, price, state);

  const periodLabel = game.sport === 'ncaab' ? `H${game.period}` : game.sport === 'nhl' ? `P${game.period}` : `Q${game.period}`;
  const gameStr = `${game.awayTeam.abbreviation} ${game.awayTeam.score} @ ${game.homeTeam.abbreviation} ${game.homeTeam.score} ${periodLabel} ${game.clock}`;

  log(prefix, `  ${sportLabel} | ${gameStr} | yesProb=${(signal.trueProb * 100).toFixed(1)}% [${signal.source}]`, state.logFile);
  log(prefix, `    Market: "${truncate(market.question, 45)}" YES=$${market.yesPrice.toFixed(2)} NO=$${market.noPrice.toFixed(2)}`, state.logFile);
  log(prefix, `    Edge: ${side} ${(edge * 100).toFixed(1)}% | size=$${size.toFixed(2)}`, state.logFile);

  const lastTrade = state.cooldowns.get(market.id) ?? 0;
  const cooledDown = Date.now() - lastTrade > COOLDOWN_MS;
  const mktExp = state.marketExposure.get(market.id) ?? 0;
  const withinCap = mktExp + size <= MAX_PER_MARKET;
  const knifeReason = isFallingKnife(state, market.id, side, market.yesPrice, market.noPrice);

  const maxPrice = side === 'YES' ? MAX_YES_PRICE : MAX_NO_PRICE;
  const reqEdge = price > 0.65 ? MIN_EDGE_HIGH : MIN_EDGE;
  if (knifeReason) {
    log(prefix, `    --- Falling knife: ${knifeReason}`, state.logFile);
  } else if (price > maxPrice) {
    log(prefix, `    --- Price too high ($${price.toFixed(2)} > $${maxPrice} ${side}) — poor risk/reward`, state.logFile);
  } else if (edge < reqEdge) {
    log(prefix, `    --- Edge too small (${(edge * 100).toFixed(1)}% < ${(reqEdge * 100).toFixed(0)}%)`, state.logFile);
  } else if (edge >= reqEdge && size >= 2 && cooledDown && withinCap && state.totalExposure + size <= state.balance) {
    state.trades.push({
      poll, time: new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' }),
      sport: sportLabel, game: gameStr, gameId, market: market.question, side, price, sizeUsd: size,
      edge, trueProb: signal.trueProb, source: signal.source, platform: state.platform,
    });
    state.totalExposure += size;
    state.marketExposure.set(market.id, mktExp + size);
    state.cooldowns.set(market.id, Date.now());
    recordPosition(state, market.id, side, price, size);
    log(prefix, `    >>> TRADE #${state.trades.length}: BUY ${side} @ $${price.toFixed(2)} for $${size.toFixed(2)} | exp=$${state.totalExposure.toFixed(2)}/${state.balance.toFixed(2)}`, state.logFile);
  } else if (!cooledDown) {
    log(prefix, `    --- Cooldown`, state.logFile);
  } else if (!withinCap) {
    log(prefix, `    --- Market cap reached ($${mktExp.toFixed(2)}/$${MAX_PER_MARKET})`, state.logFile);
  } else {
    log(prefix, `    --- Size too small or insufficient balance`, state.logFile);
  }
}

// ─── Polymarket matching ─────────────────────────────────────────────────────

/**
 * Break an ESPN display name into city + mascot + abbreviation variants.
 * E.g. "Nashville Predators" → ["nashville predators", "nashville", "predators"]
 *      "Oklahoma City Thunder" → ["oklahoma city thunder", "oklahoma city", "thunder"]
 *      "UConn Huskies" → ["uconn huskies", "uconn", "huskies"]
 */
export function extractTeamParts(displayName: string, abbreviation: string): string[] {
  const full = displayName.toLowerCase().trim();
  const abbr = abbreviation.toLowerCase().trim();
  const words = full.split(/\s+/);
  const parts: string[] = [full, abbr];

  if (words.length >= 2) {
    const mascot = words[words.length - 1];     // last word = mascot
    const city = words.slice(0, -1).join(' ');   // everything else = city
    parts.push(mascot, city);
  }

  // Deduplicate
  return [...new Set(parts)];
}

function matchesWord(question: string, part: string): boolean {
  // Use word boundary matching to avoid "la" matching "Lausanne"
  const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\b`, 'i');
  return re.test(question);
}

function findPolyMarket(game: SportGame, markets: Market[]): Market | null {
  const homeParts = extractTeamParts(game.homeTeam.name, game.homeTeam.abbreviation);
  const awayParts = extractTeamParts(game.awayTeam.name, game.awayTeam.abbreviation);

  for (const m of markets) {
    if (isFuturesMarket(m.question)) continue;
    if (m.yesPrice <= 0.01 || m.yesPrice >= 0.99) continue;
    const homeMatch = homeParts.some(p => matchesWord(m.question, p));
    const awayMatch = awayParts.some(p => matchesWord(m.question, p));
    if (homeMatch && awayMatch) return m;
  }
  return null;
}

// ─── Fetch all games (for end detection) ─────────────────────────────────────
async function fetchAllGames(espn: EspnClient, sport: 'nba' | 'ncaab' | 'nhl'): Promise<SportGame[]> {
  const paths: Record<string, string> = {
    nba: 'basketball/nba', ncaab: 'basketball/mens-college-basketball', nhl: 'hockey/nhl',
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

// ─── Kalshi sim loop ─────────────────────────────────────────────────────────
async function runKalshi(espn: EspnClient, state: SimState, stopSignal: { stopped: boolean }) {
  const PREFIX = 'KALSHI';
  const kalshi = new KalshiClient();

  log(PREFIX, 'Fetching Kalshi game markets...', state.logFile);
  let kalshiMarkets: { sport: 'nba' | 'ncaab' | 'nhl'; markets: KalshiMarket[] }[] = [
    { sport: 'nba', markets: await kalshi.getGameMarkets('nba') },
    { sport: 'ncaab', markets: await kalshi.getGameMarkets('ncaab') },
    { sport: 'nhl', markets: await kalshi.getGameMarkets('nhl') },
  ];

  const counts = kalshiMarkets.map(s => `${s.markets.length} ${s.sport.toUpperCase()}`).join(' + ');
  log(PREFIX, `Found ${counts} markets`, state.logFile);

  let consecutiveEmpty = 0;

  for (let poll = 1; poll <= MAX_POLLS && !stopSignal.stopped; poll++) {
    try {
      const [nbaLive, ncaabLive, nhlLive] = await Promise.all([
        espn.getLiveGames('nba'), espn.getLiveGames('ncaab'), espn.getLiveGames('nhl'),
      ]);
      const totalLive = nbaLive.length + ncaabLive.length + nhlLive.length;

      if (totalLive === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 5) {
          log(PREFIX, 'No live games for 10 min. Checking if all finished...', state.logFile);
          const [allNba, allNcaab, allNhl] = await Promise.all([
            fetchAllGames(espn, 'nba'), fetchAllGames(espn, 'ncaab'), fetchAllGames(espn, 'nhl'),
          ]);
          const all = [...allNba, ...allNcaab, ...allNhl];
          const finals = all.filter(g => g.status === 'final');
          const scheduled = all.filter(g => g.status === 'scheduled');
          if (finals.length > 0 && scheduled.length === 0) {
            log(PREFIX, `All games finished (${finals.length} final). Done.`, state.logFile);
            break;
          }
          log(PREFIX, `${finals.length} final, ${scheduled.length} scheduled — continuing...`, state.logFile);
          consecutiveEmpty = 0;
        } else if (poll % 3 === 0) {
          log(PREFIX, `Poll #${poll} — no live games, waiting...`, state.logFile);
        }
      } else {
        consecutiveEmpty = 0;
        log(PREFIX, `─── Poll #${poll} | ${nbaLive.length} NBA + ${ncaabLive.length} NCAAB + ${nhlLive.length} NHL live ───`, state.logFile);

        const allGames = [
          ...nbaLive.map(g => ({ game: g, sport: 'nba' as const, label: 'NBA' })),
          ...ncaabLive.map(g => ({ game: g, sport: 'ncaab' as const, label: 'NCAAB' })),
          ...nhlLive.map(g => ({ game: g, sport: 'nhl' as const, label: 'NHL' })),
        ];

        for (const { game, sport, label } of allGames) {
          // Match market FIRST so we can anchor signal to market price
          const sportMarkets = kalshiMarkets.find(s => s.sport === sport)?.markets ?? [];
          const km = kalshi.matchGameToMarket(game, sportMarkets);
          if (!km) {
            const periodLabel = game.sport === 'ncaab' ? `H${game.period}` : game.sport === 'nhl' ? `P${game.period}` : `Q${game.period}`;
            log(PREFIX, `  ${label} | ${game.awayTeam.abbreviation} ${game.awayTeam.score} @ ${game.homeTeam.abbreviation} ${game.homeTeam.score} ${periodLabel} ${game.clock} | No Kalshi market`, state.logFile);
            continue;
          }

          const market = kalshi.toMarket(km, sport, game);
          const predictor = await espn.getPredictor(game.sport, game.id);
          const signal = computeSignal(game, market.yesPrice, predictor);
          tryTrade(state, game, signal, market, label, poll, PREFIX, game.id);
        }
      }

      // Refresh Kalshi markets every 10 polls
      if (poll % 10 === 0) {
        try {
          kalshiMarkets = [
            { sport: 'nba', markets: await kalshi.getGameMarkets('nba') },
            { sport: 'ncaab', markets: await kalshi.getGameMarkets('ncaab') },
            { sport: 'nhl', markets: await kalshi.getGameMarkets('nhl') },
          ];
          const rc = kalshiMarkets.map(s => `${s.markets.length} ${s.sport.toUpperCase()}`).join(' + ');
          log(PREFIX, `Refreshed markets: ${rc}`, state.logFile);
        } catch {}
      }
    } catch (err) {
      log(PREFIX, `Poll #${poll} error: ${err}`, state.logFile);
    }

    await Bun.sleep(POLL_INTERVAL_MS);
  }
}

// ─── Polymarket sim loop ─────────────────────────────────────────────────────
async function runPolymarket(espn: EspnClient, state: SimState, stopSignal: { stopped: boolean }) {
  const PREFIX = 'POLY';
  const gamma = new GammaScanner();

  log(PREFIX, 'Fetching Polymarket markets...', state.logFile);
  const [nbaMarkets, ncaabMarkets, nhlMarkets] = await Promise.all([
    gamma.getNbaMarkets(), gamma.getNcaabMarkets(), gamma.getNhlMarkets(),
  ]);

  let allMarkets = [...nbaMarkets, ...ncaabMarkets, ...nhlMarkets];
  let pricedMarkets = allMarkets.filter(m => m.yesPrice > 0.01 && m.yesPrice < 0.99);
  log(PREFIX, `Found ${allMarkets.length} total markets (${pricedMarkets.length} with live prices)`, state.logFile);

  // Debug: dump sample market questions per sport on first poll
  const sportSamples = [
    { label: 'NBA', markets: nbaMarkets },
    { label: 'NCAAB', markets: ncaabMarkets },
    { label: 'NHL', markets: nhlMarkets },
  ];
  for (const { label, markets } of sportSamples) {
    const samples = markets.slice(0, 5).map(m => `"${truncate(m.question, 60)}"`);
    if (samples.length > 0) log(PREFIX, `  ${label} samples: ${samples.join(' | ')}`, state.logFile);
  }

  let consecutiveEmpty = 0;

  for (let poll = 1; poll <= MAX_POLLS && !stopSignal.stopped; poll++) {
    try {
      const [nbaLive, ncaabLive, nhlLive] = await Promise.all([
        espn.getLiveGames('nba'), espn.getLiveGames('ncaab'), espn.getLiveGames('nhl'),
      ]);
      const totalLive = nbaLive.length + ncaabLive.length + nhlLive.length;

      if (totalLive === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 5) {
          log(PREFIX, 'No live games for 10 min. Checking if all finished...', state.logFile);
          const [allNba, allNcaab, allNhl] = await Promise.all([
            fetchAllGames(espn, 'nba'), fetchAllGames(espn, 'ncaab'), fetchAllGames(espn, 'nhl'),
          ]);
          const all = [...allNba, ...allNcaab, ...allNhl];
          const finals = all.filter(g => g.status === 'final');
          const scheduled = all.filter(g => g.status === 'scheduled');
          if (finals.length > 0 && scheduled.length === 0) {
            log(PREFIX, `All games finished (${finals.length} final). Done.`, state.logFile);
            break;
          }
          log(PREFIX, `${finals.length} final, ${scheduled.length} scheduled — continuing...`, state.logFile);
          consecutiveEmpty = 0;
        } else if (poll % 3 === 0) {
          log(PREFIX, `Poll #${poll} — no live games, waiting...`, state.logFile);
        }
      } else {
        consecutiveEmpty = 0;
        log(PREFIX, `─── Poll #${poll} | ${nbaLive.length} NBA + ${ncaabLive.length} NCAAB + ${nhlLive.length} NHL live ───`, state.logFile);

        const allGames = [
          ...nbaLive.map(g => ({ game: g, label: 'NBA' })),
          ...ncaabLive.map(g => ({ game: g, label: 'NCAAB' })),
          ...nhlLive.map(g => ({ game: g, label: 'NHL' })),
        ];

        for (const { game, label } of allGames) {
          // Match market FIRST so we can anchor signal to market price
          const market = findPolyMarket(game, pricedMarkets);
          if (!market) {
            const periodLabel = game.sport === 'ncaab' ? `H${game.period}` : game.sport === 'nhl' ? `P${game.period}` : `Q${game.period}`;
            log(PREFIX, `  ${label} | ${game.awayTeam.abbreviation} ${game.awayTeam.score} @ ${game.homeTeam.abbreviation} ${game.homeTeam.score} ${periodLabel} ${game.clock} | No Polymarket match`, state.logFile);
            continue;
          }

          const predictor = await espn.getPredictor(game.sport, game.id);
          const signal = computeSignal(game, market.yesPrice, predictor);
          tryTrade(state, game, signal, market, label, poll, PREFIX, game.id);
        }
      }

      // Refresh Polymarket markets every 10 polls
      if (poll % 10 === 0) {
        try {
          const [freshNba, freshNcaab, freshNhl] = await Promise.all([
            gamma.getNbaMarkets(), gamma.getNcaabMarkets(), gamma.getNhlMarkets(),
          ]);
          allMarkets = [...freshNba, ...freshNcaab, ...freshNhl];
          pricedMarkets = allMarkets.filter(m => m.yesPrice > 0.01 && m.yesPrice < 0.99);
          log(PREFIX, `Refreshed markets: ${pricedMarkets.length} priced`, state.logFile);
        } catch {}
      }
    } catch (err) {
      log(PREFIX, `Poll #${poll} error: ${err}`, state.logFile);
    }

    await Bun.sleep(POLL_INTERVAL_MS);
  }
}

// ─── Resolve actual outcomes ─────────────────────────────────────────────────
async function resolveOutcomes(
  trades: SimTrade[],
  espn: EspnClient,
): Promise<Map<string, 'yes' | 'no' | 'pending'>> {
  // Collect unique game IDs and their sports
  const gameMap = new Map<string, string>();
  for (const t of trades) {
    if (!gameMap.has(t.gameId)) gameMap.set(t.gameId, t.sport.toLowerCase());
  }

  const outcomes = new Map<string, 'yes' | 'no' | 'pending'>();

  // Fetch final scores from ESPN for each sport
  const sportPaths: Record<string, string> = {
    nba: 'basketball/nba', ncaab: 'basketball/mens-college-basketball', nhl: 'hockey/nhl',
  };

  const sportGames = new Map<string, any>();
  for (const sport of ['nba', 'ncaab', 'nhl']) {
    try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sportPaths[sport]}/scoreboard`);
      const data = (await res.json()) as any;
      for (const ev of data.events ?? []) {
        sportGames.set(ev.id, ev);
      }
    } catch {}
  }

  for (const [gameId, sport] of gameMap) {
    const ev = sportGames.get(gameId);
    if (!ev) { outcomes.set(gameId, 'pending'); continue; }

    const comp = ev.competitions?.[0];
    const state = comp?.status?.type?.state;
    if (state !== 'post') { outcomes.set(gameId, 'pending'); continue; }

    const home = comp.competitors.find((c: any) => c.homeAway === 'home');
    const away = comp.competitors.find((c: any) => c.homeAway === 'away');
    const homeScore = parseInt(home?.score ?? '0');
    const awayScore = parseInt(away?.score ?? '0');

    // Kalshi YES = away team (first team in "A at B" format)
    // Away team won → YES wins; Home team won → NO wins
    if (awayScore > homeScore) {
      outcomes.set(gameId, 'yes');
    } else {
      outcomes.set(gameId, 'no');
    }
  }

  return outcomes;
}

// ─── Summary printer ─────────────────────────────────────────────────────────
async function printSimSummary(state: SimState, espn: EspnClient) {
  const prefix = state.platform.toUpperCase();
  console.log();
  console.log(`╔═══════════════════════════════════════════════════════════════╗`);
  console.log(`║  ${prefix.padEnd(10)} SESSION COMPLETE                               ║`);
  console.log(`╠═══════════════════════════════════════════════════════════════╣`);

  if (state.trades.length === 0) {
    console.log(`║  No trades triggered.                                        ║`);
    console.log(`║  Balance: $${STARTING_BALANCE.toFixed(2).padStart(8)} USDC                                  ║`);
  } else {
    console.log(`║  Trades (dry-run):                                           ║`);
    for (let i = 0; i < state.trades.length; i++) {
      const t = state.trades[i];
      const line = `  #${i + 1} ${t.sport.padEnd(5)} ${t.time} | ${t.side} @ $${t.price.toFixed(2)} | $${t.sizeUsd.toFixed(2)} | edge=${(t.edge * 100).toFixed(1)}%`;
      console.log(`║${line.padEnd(62)}║`);
    }

    // Resolve actual outcomes from ESPN final scores
    const outcomes = await resolveOutcomes(state.trades, espn);

    let simBalance = STARTING_BALANCE;
    let wins = 0;
    let pending = 0;
    console.log(`║                                                              ║`);
    console.log(`║  Actual outcomes:                                            ║`);
    for (const t of state.trades) {
      const outcome = outcomes.get(t.gameId) ?? 'pending';
      let won: boolean;
      let resultStr: string;

      if (outcome === 'pending') {
        pending++;
        resultStr = 'PEND';
        won = false;
      } else {
        // YES outcome means away team won; NO outcome means home team won
        won = (t.side === 'YES' && outcome === 'yes') || (t.side === 'NO' && outcome === 'no');
        resultStr = won ? 'WIN ' : 'LOSS';
      }

      if (outcome !== 'pending') {
        if (won) { wins++; simBalance += t.sizeUsd * ((1 / t.price) - 1); }
        else { simBalance -= t.sizeUsd; }
      }

      const pnl = outcome === 'pending' ? '     ?' :
        won ? `+$${(t.sizeUsd * ((1 / t.price) - 1)).toFixed(2)}` : `-$${t.sizeUsd.toFixed(2)}`;
      console.log(`║    ${resultStr} ${pnl.padStart(10)} | ${truncate(t.game, 30).padEnd(30)}  ║`);
    }

    const resolved = state.trades.length - pending;
    const totalPnl = simBalance - STARTING_BALANCE;
    console.log(`║                                                              ║`);
    console.log(`║  Starting:   $${STARTING_BALANCE.toFixed(2).padStart(8)}  |  Exposure: $${state.totalExposure.toFixed(2).padStart(8)}        ║`);
    console.log(`║  Win/Loss:   ${String(wins).padStart(3)}W / ${String(resolved - wins)}L  |  Markets: ${String(state.marketExposure.size).padStart(3)}               ║`);
    if (pending > 0) console.log(`║  Pending:    ${String(pending).padStart(3)}                                               ║`);
    console.log(`║  P&L:       ${(totalPnl >= 0 ? '+' : '')}$${totalPnl.toFixed(2).padStart(8)}  |  Final: $${simBalance.toFixed(2).padStart(8)}          ║`);
    console.log(`║  Return:     ${((simBalance / STARTING_BALANCE - 1) * 100).toFixed(1).padStart(7)}%                                     ║`);
  }

  console.log(`╚═══════════════════════════════════════════════════════════════╝`);
  console.log(`Log: ${state.logFile}`);
}

// ─── Post-game settlement ────────────────────────────────────────────────────
const SETTLEMENT_POLL_MS   = 2 * 60 * 1000;   // poll every 2 min
const SETTLEMENT_MAX_MS    = 60 * 60 * 1000;   // give up after 60 min
const SETTLEMENT_LOG       = `data/logs/tonight-settlement-${TODAY}.log`;

async function settleTradesPhase(allTrades: SimTrade[], espn: EspnClient) {
  if (allTrades.length === 0) {
    console.log('No trades to settle.');
    return;
  }

  const PREFIX = 'SETTLE';
  log(PREFIX, `Starting settlement phase for ${allTrades.length} trades...`, SETTLEMENT_LOG);

  // Collect unique game IDs
  const gameIds = [...new Set(allTrades.map(t => t.gameId))];
  log(PREFIX, `Waiting for ${gameIds.length} games to reach final status`, SETTLEMENT_LOG);

  const settled = new Set<string>();
  const start = Date.now();

  while (settled.size < gameIds.length && Date.now() - start < SETTLEMENT_MAX_MS) {
    const outcomes = await resolveOutcomes(allTrades, espn);

    for (const gid of gameIds) {
      if (settled.has(gid)) continue;
      const outcome = outcomes.get(gid);
      if (outcome && outcome !== 'pending') {
        settled.add(gid);
        const result = outcome === 'yes' ? 'AWAY WIN' : 'HOME WIN';
        log(PREFIX, `  Game ${gid}: ${result}`, SETTLEMENT_LOG);
      }
    }

    if (settled.size < gameIds.length) {
      const remaining = gameIds.length - settled.size;
      log(PREFIX, `${settled.size}/${gameIds.length} settled, ${remaining} pending — waiting 2 min...`, SETTLEMENT_LOG);
      await Bun.sleep(SETTLEMENT_POLL_MS);
    }
  }

  if (settled.size < gameIds.length) {
    const unsettled = gameIds.filter(g => !settled.has(g));
    log(PREFIX, `Timed out after 60 min. Unsettled games: ${unsettled.join(', ')}`, SETTLEMENT_LOG);
  } else {
    log(PREFIX, `All ${gameIds.length} games settled!`, SETTLEMENT_LOG);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  POLYARB TONIGHT SIM  │  Kalshi + Polymarket  │  $50 each   ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log();

  // Auto-wait until tip-off. Use START_HOUR env var to override (e.g. START_HOUR=13 for 1 PM ET)
  const startHour = parseInt(process.env.START_HOUR ?? '19', 10);
  const startMin = parseInt(process.env.START_MIN ?? '5', 10);

  const now = new Date();
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const tipOff = new Date(etNow);
  tipOff.setHours(startHour, startMin, 0, 0);

  // If it's before tip-off time, wait
  const etHour = etNow.getHours();
  const etMin = etNow.getMinutes();
  if (etHour < startHour || (etHour === startHour && etMin < startMin)) {
    const waitMs = tipOff.getTime() - etNow.getTime();
    const waitMin = Math.round(waitMs / 60000);
    const timeLabel = `${startHour > 12 ? startHour - 12 : startHour}:${String(startMin).padStart(2, '0')} ${startHour >= 12 ? 'PM' : 'AM'}`;
    console.log(`Current time: ${etNow.toLocaleTimeString('en-US')} ET`);
    console.log(`Waiting ${waitMin} minutes until tip-off (~${timeLabel} ET)...`);
    console.log(`Will start both Kalshi and Polymarket sims at game time.`);
    console.log();
    await Bun.sleep(waitMs);
  }

  console.log(`Game time! Launching both sims...`);
  console.log();

  const espn = new EspnClient();
  const kalshiState = createState('kalshi', KALSHI_LOG);
  const polyState = createState('polymarket', POLY_LOG);
  const stopSignal = { stopped: false };

  // Graceful shutdown — set stop signal so loops exit, then settlement runs
  process.on('SIGINT', () => {
    console.log('\nSIGINT received — stopping polling loops, will settle trades...');
    stopSignal.stopped = true;
  });
  process.on('SIGTERM', () => {
    console.log('\nSIGTERM received — stopping polling loops, will settle trades...');
    stopSignal.stopped = true;
  });

  // Run both in parallel
  await Promise.all([
    runKalshi(espn, kalshiState, stopSignal),
    runPolymarket(espn, polyState, stopSignal),
  ]);

  // Settle trades — wait for games to finish before printing final results
  const allTrades = [...kalshiState.trades, ...polyState.trades];
  await settleTradesPhase(allTrades, espn);

  // Print final summaries (now with settled outcomes)
  await printSimSummary(kalshiState, espn);
  await printSimSummary(polyState, espn);
  printCombinedSummary(kalshiState, polyState);
}

function printCombinedSummary(kalshi: SimState, poly: SimState) {
  const totalTrades = kalshi.trades.length + poly.trades.length;
  console.log();
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                   COMBINED SUMMARY                            ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log(`║  Kalshi trades:     ${String(kalshi.trades.length).padStart(4)}  |  Polymarket trades: ${String(poly.trades.length).padStart(4)}     ║`);
  console.log(`║  Kalshi exposure:  $${kalshi.totalExposure.toFixed(2).padStart(7)} |  Poly exposure:    $${poly.totalExposure.toFixed(2).padStart(7)}  ║`);
  console.log(`║  Total trades:      ${String(totalTrades).padStart(4)}                                    ║`);
  console.log(`║  Total capital:    $${(STARTING_BALANCE * 2).toFixed(2).padStart(7)} ($${STARTING_BALANCE} × 2 sims)              ║`);
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Logs saved to:`);
  console.log(`  ${KALSHI_LOG}`);
  console.log(`  ${POLY_LOG}`);
}

main().catch(console.error);
