import { describe, it, expect } from 'bun:test';
import { CONFIG } from '../src/config';

describe('CONFIG', () => {
  it('has required trading parameters', () => {
    expect(CONFIG.minEdge).toBeGreaterThan(0);
    expect(CONFIG.kellyFraction).toBeGreaterThan(0);
    expect(CONFIG.kellyFraction).toBeLessThanOrEqual(1);
    expect(CONFIG.maxPositionUsd).toBeGreaterThan(0);
    expect(CONFIG.maxDailyLoss).toBeGreaterThan(0);
    expect(CONFIG.totalCapitalUsd).toBeGreaterThan(0);
  });

  it('has valid position exit parameters', () => {
    expect(CONFIG.takeProfitMultiplier).toBeGreaterThan(0);
    expect(CONFIG.trailingStopPct).toBeGreaterThan(0);
    expect(CONFIG.trailingStopPct).toBeLessThanOrEqual(1);
    expect(CONFIG.hardStopLossPct).toBeGreaterThan(0);
    expect(CONFIG.maxHoldTimeMs).toBeGreaterThan(0);
  });

  it('has valid Polymarket endpoints', () => {
    expect(CONFIG.clobHost).toStartWith('https://');
    expect(CONFIG.gammaHost).toStartWith('https://');
    expect(CONFIG.wssHost).toStartWith('wss://');
  });

  it('has valid exchange addresses', () => {
    expect(CONFIG.ctfExchange).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(CONFIG.negRiskExchange).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it('dryRun defaults to true', () => {
    expect(CONFIG.dryRun).toBe(true);
  });
});
