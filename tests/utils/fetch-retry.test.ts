import { describe, it, expect, mock } from 'bun:test';
import { fetchWithRetry } from '../../src/utils/fetch-retry';

describe('fetchWithRetry', () => {
  it('returns response on first success', async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response('ok', { status: 200 }))
    );
    globalThis.fetch = mockFetch as any;

    const res = await fetchWithRetry('https://example.com');
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds', async () => {
    let calls = 0;
    globalThis.fetch = mock(() => {
      calls++;
      if (calls < 3) return Promise.reject(new Error('network'));
      return Promise.resolve(new Response('ok', { status: 200 }));
    }) as any;

    const res = await fetchWithRetry('https://example.com', {}, 3, 10);
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
  });

  it('throws after max retries exceeded', async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error('network'))
    ) as any;

    expect(
      fetchWithRetry('https://example.com', {}, 2, 10)
    ).rejects.toThrow('network');
  });

  it('retries on 429 status', async () => {
    let calls = 0;
    globalThis.fetch = mock(() => {
      calls++;
      if (calls < 2) return Promise.resolve(new Response('rate limited', { status: 429 }));
      return Promise.resolve(new Response('ok', { status: 200 }));
    }) as any;

    const res = await fetchWithRetry('https://example.com', {}, 3, 10);
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });
});
