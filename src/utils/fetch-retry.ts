import { CONFIG } from '../config';

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  maxRetries = CONFIG.maxRetries,
  baseDelayMs = CONFIG.retryBaseMs,
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status === 429 && attempt < maxRetries) {
        await Bun.sleep(baseDelayMs * 2 ** attempt);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxRetries) {
        await Bun.sleep(baseDelayMs * 2 ** attempt);
      }
    }
  }

  throw lastError ?? new Error(`fetchWithRetry failed after ${maxRetries} retries`);
}
