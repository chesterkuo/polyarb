/**
 * Scout Polymarket for individual game markets (not futures).
 * Run periodically to detect when game-specific markets appear.
 *
 * Usage: bun run src/market-scout.ts
 *        bun run src/market-scout.ts --watch   (re-check every 30 min)
 */

import { GammaScanner } from './data/polymarket-gamma';
import { EspnClient } from './data/espn/espn-client';
import type { Market, SportGame } from './types';

const FUTURES_KEYWORDS = [
  'finals', 'championship', 'playoffs', 'make the', 'win the', 'mvp',
  'award', 'season', 'conference', 'tournament', 'best record', 'worst record',
  'first pick', 'draft', 'regular season', 'over/under wins',
];

function isFuturesMarket(q: string): boolean {
  const low = q.toLowerCase();
  return FUTURES_KEYWORDS.some(kw => low.includes(kw));
}

function matchesGame(market: Market, game: SportGame): boolean {
  const q = market.question.toLowerCase();
  const hName = game.homeTeam.name.toLowerCase();
  const aName = game.awayTeam.name.toLowerCase();
  const hAbbr = game.homeTeam.abbreviation.toLowerCase();
  const aAbbr = game.awayTeam.abbreviation.toLowerCase();
  return (q.includes(hName) || q.includes(hAbbr)) &&
         (q.includes(aName) || q.includes(aAbbr));
}

async function scout() {
  const ts = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  console.log(`\n=== Market Scout — ${ts} ET ===\n`);

  const gamma = new GammaScanner();
  const espn = new EspnClient();

  // Fetch all markets
  const [nbaMarkets, ncaabMarkets] = await Promise.all([
    gamma.getNbaMarkets(),
    gamma.getNcaabMarkets(),
  ]);
  const allMarkets = [...nbaMarkets, ...ncaabMarkets];
  const priced = allMarkets.filter(m => m.yesPrice > 0.01 && m.yesPrice < 0.99);

  // Separate futures vs non-futures
  const futures = priced.filter(m => isFuturesMarket(m.question));
  const nonFutures = priced.filter(m => !isFuturesMarket(m.question));

  console.log(`Total priced markets: ${priced.length}`);
  console.log(`  Futures/season-long: ${futures.length}`);
  console.log(`  Potential game markets: ${nonFutures.length}`);
  console.log();

  // Fetch upcoming/live games
  const [nbaGames, ncaabGames] = await Promise.all([
    fetchAllGames('nba'),
    fetchAllGames('ncaab'),
  ]);
  const upcomingGames = [...nbaGames, ...ncaabGames].filter(
    g => g.status === 'scheduled' || g.status === 'in_progress'
  );

  console.log(`Upcoming/live games: ${upcomingGames.length}`);
  for (const g of upcomingGames) {
    const status = g.status === 'in_progress' ? 'LIVE' : 'upcoming';
    console.log(`  ${g.sport.toUpperCase().padEnd(5)} ${g.awayTeam.abbreviation} @ ${g.homeTeam.abbreviation} [${status}]`);
  }
  console.log();

  // Check if any non-futures market matches an upcoming game
  const gameMarkets: Array<{ market: Market; game: SportGame }> = [];
  for (const m of nonFutures) {
    for (const g of upcomingGames) {
      if (matchesGame(m, g)) {
        gameMarkets.push({ market: m, game: g });
      }
    }
  }

  // Also check ALL markets (including unclassified) for game matchups
  for (const m of priced) {
    if (isFuturesMarket(m.question)) continue;
    for (const g of upcomingGames) {
      if (matchesGame(m, g) && !gameMarkets.some(gm => gm.market.id === m.id)) {
        gameMarkets.push({ market: m, game: g });
      }
    }
  }

  if (gameMarkets.length > 0) {
    console.log('*** GAME MARKETS FOUND! ***');
    for (const { market, game } of gameMarkets) {
      console.log(`  "${market.question}"`);
      console.log(`    YES=$${market.yesPrice.toFixed(2)} NO=$${market.noPrice.toFixed(2)}`);
      console.log(`    Game: ${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`);
      console.log();
    }
    return true;
  } else {
    console.log('No individual game markets found yet.');
    console.log('All markets are futures/championship/season-long.');

    // Show any non-futures for manual inspection
    if (nonFutures.length > 0) {
      console.log('\nNon-futures markets (might be game-adjacent):');
      for (const m of nonFutures.slice(0, 10)) {
        console.log(`  "${m.question}" YES=$${m.yesPrice.toFixed(2)}`);
      }
    }
    return false;
  }
}

async function fetchAllGames(sport: 'nba' | 'ncaab'): Promise<SportGame[]> {
  const paths: Record<string, string> = {
    nba: 'basketball/nba',
    ncaab: 'basketball/mens-college-basketball',
  };
  // Check today + tomorrow
  const dates = [new Date()];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  dates.push(tomorrow);

  const all: SportGame[] = [];
  for (const d of dates) {
    const dateStr = d.toISOString().split('T')[0].replace(/-/g, '');
    try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${paths[sport]}/scoreboard?dates=${dateStr}`);
      const data = (await res.json()) as any;
      for (const ev of data.events ?? []) {
        const comp = ev.competitions?.[0];
        if (!comp) continue;
        const home = comp.competitors.find((c: any) => c.homeAway === 'home');
        const away = comp.competitors.find((c: any) => c.homeAway === 'away');
        const state = comp.status?.type?.state;
        all.push({
          id: ev.id, sport: sport as any,
          homeTeam: { name: home?.team?.displayName ?? '', abbreviation: home?.team?.abbreviation ?? '', score: parseInt(home?.score ?? '0') },
          awayTeam: { name: away?.team?.displayName ?? '', abbreviation: away?.team?.abbreviation ?? '', score: parseInt(away?.score ?? '0') },
          period: comp.status?.period ?? 0, clock: comp.status?.displayClock ?? '',
          status: state === 'post' ? 'final' as const : state === 'in' ? 'in_progress' as const : 'scheduled' as const,
        });
      }
    } catch {}
  }
  return all;
}

// Main
const watchMode = process.argv.includes('--watch');

if (watchMode) {
  console.log('Watch mode: checking every 30 minutes...');
  while (true) {
    const found = await scout();
    if (found) {
      console.log('\n=== GAME MARKETS DETECTED — Ready to run live-sim.ts ===');
    }
    await Bun.sleep(30 * 60 * 1000);
  }
} else {
  await scout();
}
