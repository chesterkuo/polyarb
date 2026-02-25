/**
 * Check upcoming game schedules from ESPN.
 * Usage: bun run src/schedule.ts
 */

interface Competitor {
  homeAway: string;
  team: { displayName: string; abbreviation: string };
  score: string;
}

interface EspnEvent {
  competitions: Array<{
    date: string;
    competitors: Competitor[];
    status: { type: { state: string; detail: string; shortDetail: string }; displayClock: string };
  }>;
}

interface EspnScoreboard {
  events: EspnEvent[];
  leagues?: Array<{ calendarStartDate?: string; calendarEndDate?: string }>;
}

const sports = [
  { name: 'NBA', url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard' },
  { name: 'NCAAB', url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard' },
  { name: 'NHL', url: 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard' },
];

async function checkSchedule() {
  const now = new Date();
  console.log(`Schedule check at ${now.toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`);
  console.log();

  for (const sport of sports) {
    // Check today
    const res = await fetch(sport.url);
    const data = (await res.json()) as EspnScoreboard;

    console.log(`══ ${sport.name} — Today ════════════════════════════════════`);
    printGames(data.events);
    console.log();

    // Check tomorrow
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tmrStr = tomorrow.toISOString().split('T')[0].replace(/-/g, '');
    const res2 = await fetch(`${sport.url}?dates=${tmrStr}`);
    const data2 = (await res2.json()) as EspnScoreboard;

    console.log(`── ${sport.name} — Tomorrow ──────────────────────────────────`);
    printGames(data2.events);
    console.log();
  }
}

function printGames(events: EspnEvent[]) {
  if (!events || events.length === 0) {
    console.log('  No games scheduled.');
    return;
  }

  for (const ev of events) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const home = comp.competitors.find(c => c.homeAway === 'home');
    const away = comp.competitors.find(c => c.homeAway === 'away');
    const state = comp.status?.type?.state;
    const detail = comp.status?.type?.shortDetail || comp.status?.type?.detail || '';
    const date = new Date(comp.date);
    const timeStr = date.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });

    const awayName = away?.team?.displayName ?? '?';
    const homeName = home?.team?.displayName ?? '?';
    const awayAbbr = away?.team?.abbreviation ?? '';
    const homeAbbr = home?.team?.abbreviation ?? '';

    let statusLine: string;
    if (state === 'pre') {
      statusLine = `  ${awayAbbr.padEnd(4)} ${awayName.padEnd(25)} @ ${homeAbbr.padEnd(4)} ${homeName.padEnd(25)} | ${timeStr}`;
    } else if (state === 'in') {
      statusLine = `  ${awayAbbr.padEnd(4)} ${away?.score?.padStart(3) ?? '?'} @ ${homeAbbr.padEnd(4)} ${home?.score?.padStart(3) ?? '?'} | LIVE ${detail}`;
    } else {
      statusLine = `  ${awayAbbr.padEnd(4)} ${away?.score?.padStart(3) ?? '?'} @ ${homeAbbr.padEnd(4)} ${home?.score?.padStart(3) ?? '?'} | FINAL`;
    }
    console.log(statusLine);
  }
}

checkSchedule().catch(console.error);
