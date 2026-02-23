import { describe, it, expect } from 'bun:test';
import { WsListener } from '../../src/data/polymarket-ws';

describe('WsListener', () => {
  it('getLatestPrice returns 0 for unknown token', () => {
    const ws = new WsListener();
    expect(ws.getLatestPrice('unknown-token')).toBe(0);
  });

  it('isConnected returns false when not connected', () => {
    const ws = new WsListener();
    expect(ws.isConnected()).toBe(false);
  });

  it('subscribe tracks subscriptions without throwing', () => {
    const ws = new WsListener();
    expect(() => ws.subscribe('token-123')).not.toThrow();
    expect(() => ws.subscribe('token-456')).not.toThrow();
  });

  it('close does not throw when not connected', () => {
    const ws = new WsListener();
    expect(() => ws.close()).not.toThrow();
  });
});
