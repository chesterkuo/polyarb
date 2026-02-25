import { test, expect } from 'bun:test';
import { parseClockToMinutes } from '../../src/signals/wp-models/parse-clock';

test('parses MM:SS format', () => {
  expect(parseClockToMinutes('12:00')).toBeCloseTo(12.0, 2);
  expect(parseClockToMinutes('5:30')).toBeCloseTo(5.5, 2);
  expect(parseClockToMinutes('0:45')).toBeCloseTo(0.75, 2);
});

test('parses seconds-only format (no colon)', () => {
  expect(parseClockToMinutes('33.1')).toBeCloseTo(33.1 / 60, 2);
  expect(parseClockToMinutes('0.0')).toBe(0);
  expect(parseClockToMinutes('5.5')).toBeCloseTo(5.5 / 60, 2);
});

test('handles empty/undefined clock', () => {
  expect(parseClockToMinutes('')).toBe(0);
});

test('handles 0:00 correctly', () => {
  expect(parseClockToMinutes('0:00')).toBe(0);
});
