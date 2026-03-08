import { test, expect, describe } from 'bun:test';
import { extractTeamParts } from '../src/tonight-sim';
import type { Market, SportGame } from '../src/types';

// ─── extractTeamParts ────────────────────────────────────────────────────────
describe('extractTeamParts', () => {
  test('splits city + mascot for two-word names', () => {
    const parts = extractTeamParts('Nashville Predators', 'NSH');
    expect(parts).toContain('nashville predators');
    expect(parts).toContain('nashville');
    expect(parts).toContain('predators');
    expect(parts).toContain('nsh');
  });

  test('splits multi-word city name', () => {
    const parts = extractTeamParts('Oklahoma City Thunder', 'OKC');
    expect(parts).toContain('oklahoma city thunder');
    expect(parts).toContain('oklahoma city');
    expect(parts).toContain('thunder');
    expect(parts).toContain('okc');
  });

  test('handles single-word college names', () => {
    const parts = extractTeamParts('Georgetown Hoyas', 'GTOWN');
    expect(parts).toContain('georgetown hoyas');
    expect(parts).toContain('georgetown');
    expect(parts).toContain('hoyas');
    expect(parts).toContain('gtown');
  });

  test('handles abbreviation-style names like UConn', () => {
    const parts = extractTeamParts('UConn Huskies', 'CONN');
    expect(parts).toContain('uconn huskies');
    expect(parts).toContain('uconn');
    expect(parts).toContain('huskies');
    expect(parts).toContain('conn');
  });

  test('deduplicates when mascot equals abbreviation', () => {
    // Edge case: if abbr happens to be the mascot
    const parts = extractTeamParts('Carolina Hurricanes', 'CAR');
    const unique = new Set(parts);
    expect(unique.size).toBe(parts.length);
  });
});

// ─── Word boundary matching helper (mirrors matchesWord in tonight-sim) ──────
function matchesWord(question: string, part: string): boolean {
  const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(question);
}

// ─── Matching integration ───────────────────────────────────────────────────
describe('Polymarket question matching', () => {
  test('matches city-only market question', () => {
    const parts = extractTeamParts('Nashville Predators', 'NSH');
    const q = 'Will Nashville win tonight?';
    expect(parts.some(p => matchesWord(q, p))).toBe(true);
  });

  test('matches mascot-only market question', () => {
    const parts = extractTeamParts('Nashville Predators', 'NSH');
    const q = 'Predators vs Stars - Who wins?';
    expect(parts.some(p => matchesWord(q, p))).toBe(true);
  });

  test('matches abbreviation in market question', () => {
    const parts = extractTeamParts('Oklahoma City Thunder', 'OKC');
    const q = 'OKC at Denver - Winner?';
    expect(parts.some(p => matchesWord(q, p))).toBe(true);
  });

  test('matches full name in market question', () => {
    const parts = extractTeamParts('Georgetown Hoyas', 'GTOWN');
    const q = 'Georgetown Hoyas vs Villanova Wildcats';
    expect(parts.some(p => matchesWord(q, p))).toBe(true);
  });

  test('does not match unrelated team', () => {
    const parts = extractTeamParts('Nashville Predators', 'NSH');
    const q = 'Will the Dallas Stars win?';
    expect(parts.some(p => matchesWord(q, p))).toBe(false);
  });

  test('does not match "LA" or "SA" as substring of other words', () => {
    // Bug: LAC @ SA matched "SNHL: Fribourg-Gotteron vs. Lausanne"
    // "la" matched "Lausanne", "sa" matched "Lausanne"
    const awayParts = extractTeamParts('LA Clippers', 'LAC');
    const homeParts = extractTeamParts('San Antonio Spurs', 'SA');
    const q = 'SNHL: Fribourg-Gotteron vs. Lausanne';
    expect(awayParts.some(p => matchesWord(q, p))).toBe(false);
    expect(homeParts.some(p => matchesWord(q, p))).toBe(false);
  });
});
