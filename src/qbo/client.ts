import { randomUUID } from 'node:crypto';
import { backoffDelayMs, withRetries } from '../lib/backoff.js';

/**
 * Minimal typed client for the QBO Accounting API (v3), used by the live
 * repros in later chapters. Deliberately not the official SDK: each chapter
 * needs the raw request/response visible, and ~100 lines is cheaper to read
 * than an SDK's abstraction when the whole point is inspecting failures.
 *
 * Two behaviors here ARE the lesson, not incidental plumbing:
 *
 *  1. Every write carries a `requestid`. Intuit deduplicates creates that
 *     share a requestid — so when a create's response is lost (timeout,
 *     crash, network), retrying WITH the same requestid is safe, and
 *     retrying WITHOUT one is how duplicate invoices are born.
 *     https://developer.intuit.com/app/developer/qbo/docs/learn/learn-basic-field-definitions
 *
 *  2. Throttles (429) and transient errors (5xx) back off differently.
 *     Intuit's guidance for 429 is to wait on the order of a minute; the
 *     client honors Retry-After when present and otherwise waits
 *     `throttleDelayMs` (default 60s). Transient 5xx errors use jittered
 *     exponential backoff. 4xx business failures are never blind-retried.
 */

export class QboApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
    /** Parsed Retry-After header (ms), when the response carried one. */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'QboApiError';
  }
}

export interface QboClientOptions {
  accessToken: string;
  realmId: string;
  baseUrl?: string;
  minorVersion?: number;
  /** Wait before retrying a 429 without a Retry-After header. Default 60s per Intuit guidance. */
  throttleDelayMs?: number;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface WriteOptions {
  /**
   * Idempotency key for this logical write. Provide your own (stored with
   * the pending operation) if a retry may happen from a different process;
   * otherwise one is generated per write() call and reused across the
   * in-process retries below.
   */
  requestId?: string;
}

export class QboClient {
  private readonly baseUrl: string;
  private readonly minorVersion: number;
  private readonly throttleDelayMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: QboClientOptions) {
    this.baseUrl = opts.baseUrl ?? 'https://sandbox-quickbooks.api.intuit.com';
    // 75 is the only minor version Intuit serves since Aug 2025.
    this.minorVersion = opts.minorVersion ?? 75;
    this.throttleDelayMs = opts.throttleDelayMs ?? 60_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  static fromEnv(): QboClient {
    const accessToken = process.env.QBO_ACCESS_TOKEN;
    const realmId = process.env.QBO_REALM_ID;
    if (!accessToken || !realmId) {
      throw new Error('Set QBO_ACCESS_TOKEN and QBO_REALM_ID (see .env.example) to run live repros.');
    }
    return new QboClient({ accessToken, realmId, baseUrl: process.env.QBO_BASE_URL });
  }

  /** Run a QBO query, e.g. `SELECT * FROM Invoice MAXRESULTS 10`. */
  async query<T = unknown>(statement: string): Promise<T> {
    const url = `${this.baseUrl}/v3/company/${this.opts.realmId}/query?query=${encodeURIComponent(statement)}&minorversion=${this.minorVersion}`;
    return this.request<T>('GET', url);
  }

  /** Read one entity by ID, e.g. read('invoice', '145'). */
  async read<T = unknown>(entity: string, id: string): Promise<T> {
    const url = `${this.baseUrl}/v3/company/${this.opts.realmId}/${entity}/${id}?minorversion=${this.minorVersion}`;
    return this.request<T>('GET', url);
  }

  /**
   * Create or update an entity. Pass sparse updates explicitly in the body.
   * Always sends a `requestid` so a lost response + retry cannot double-create.
   */
  async write<T = unknown>(entity: string, body: unknown, writeOpts: WriteOptions = {}): Promise<T> {
    const requestId = writeOpts.requestId ?? randomUUID();
    const url = `${this.baseUrl}/v3/company/${this.opts.realmId}/${entity}?minorversion=${this.minorVersion}&requestid=${encodeURIComponent(requestId)}`;
    return this.request<T>('POST', url, body);
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    return withRetries(
      async () => {
        const response = await this.fetchImpl(url, {
          method,
          headers: {
            authorization: `Bearer ${this.opts.accessToken}`,
            accept: 'application/json',
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });

        const text = await response.text();
        const json = text ? JSON.parse(text) : undefined;
        if (!response.ok) {
          const retryAfterHeader = response.headers.get('retry-after');
          const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
          throw new QboApiError(
            `${method} ${url} -> ${response.status}`,
            response.status,
            json,
            Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
          );
        }
        return json as T;
      },
      {
        // Retry throttles and transient server errors; never retry 4xx business
        // failures — a blind retry on those is how duplicates get created.
        isRetryable: (error) =>
          error instanceof QboApiError && (error.status === 429 || error.status >= 500),
        delayMs: (attempt, error) => {
          if (error instanceof QboApiError && error.status === 429) {
            return error.retryAfterMs ?? this.throttleDelayMs;
          }
          return backoffDelayMs(attempt);
        },
      },
    );
  }
}
