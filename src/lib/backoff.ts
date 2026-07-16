/**
 * Exponential backoff with full jitter, for retrying throttled (429) or
 * transient (5xx) QuickBooks API calls.
 *
 * QBO throttles at 500 requests/min per realm per app and returns 429 with
 * errorCode 003001 on breach. Retrying without jitter synchronizes clients
 * and turns one throttle into a storm — see the rate-limit chapter (roadmap).
 *
 * Note: generic jittered backoff is the right shape for TRANSIENT errors.
 * Throttles are different — Intuit's guidance for 429 is to back off for on
 * the order of a minute, so the client overrides the delay for 429 responses
 * (see src/qbo/client.ts) instead of using this curve.
 */
export function backoffDelayMs(attempt: number, baseMs = 500, capMs = 60_000): number {
  const exponential = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.random() * exponential; // full jitter
}

export interface RetryOptions {
  maxAttempts?: number;
  isRetryable?: (error: unknown) => boolean;
  /** Override the wait before the next attempt (e.g. Retry-After for 429s). */
  delayMs?: (attempt: number, error: unknown) => number;
}

export async function withRetries<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const isRetryable = opts.isRetryable ?? (() => true);

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === maxAttempts - 1) throw error;
      const delay = opts.delayMs ? opts.delayMs(attempt, error) : backoffDelayMs(attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
