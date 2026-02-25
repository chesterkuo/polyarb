/**
 * Parse ESPN clock strings into minutes remaining in the current period.
 *
 * ESPN returns clocks in multiple formats:
 *   "12:00"  → MM:SS (standard)
 *   "5:30"   → MM:SS
 *   "0.0"    → seconds only (end of period)
 *   "33.1"   → seconds only (under 1 minute)
 *   ""       → empty (between periods)
 */
export function parseClockToMinutes(clock: string): number {
  if (!clock || clock.trim() === '') return 0;

  if (clock.includes(':')) {
    const [m, s] = clock.split(':').map(Number);
    return (m || 0) + (s || 0) / 60;
  }

  // Seconds-only format (e.g., "33.1", "0.0")
  const secs = parseFloat(clock);
  return isNaN(secs) ? 0 : secs / 60;
}
