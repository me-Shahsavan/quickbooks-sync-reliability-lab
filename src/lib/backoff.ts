/**
 * Exponential backoff with full jitter, for retrying throttled (429) or
 * transient (5xx) QuickBooks API calls.
 *
 * QBO throttles at 500 requests/min per realm per app and returns 429 with
 * errorCode 003001 on breach. Retrying without jitter synchronizes clients
 * and turns one throttle into a storm — see the rate-limit chapter (roadmap).
 */
export function backoffDelayMs(attempt: number, baseMs = 500, capMs = 60_000): number {
  const exponential = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.random() * exponential; // full jitter
}

export async function withRetries<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; isRetryable?: (error: unknown) => boolean } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const isRetryable = opts.isRetryable ?? (() => true);

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === maxAttempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, backoffDelayMs(attempt)));
    }
  }
  throw lastError;
}
