import { withRetries } from '../lib/backoff.js';

/**
 * Minimal typed client for the QBO Accounting API (v3), used by the live
 * repros in later chapters. Deliberately not the official SDK: each chapter
 * needs the raw request/response visible, and ~80 lines is cheaper to read
 * than an SDK's abstraction when the whole point is inspecting failures.
 *
 * All chapters run offline against fixtures by default; this client only
 * comes into play when you point a repro at your own sandbox company
 * (see .env.example).
 */

export class QboApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
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
}

export class QboClient {
  private readonly baseUrl: string;
  private readonly minorVersion: number;

  constructor(private readonly opts: QboClientOptions) {
    this.baseUrl = opts.baseUrl ?? 'https://sandbox-quickbooks.api.intuit.com';
    // 75 is the only minor version Intuit serves since Aug 2025.
    this.minorVersion = opts.minorVersion ?? 75;
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

  /** Create or update an entity. Pass sparse updates explicitly in the body. */
  async write<T = unknown>(entity: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}/v3/company/${this.opts.realmId}/${entity}?minorversion=${this.minorVersion}`;
    return this.request<T>('POST', url, body);
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    return withRetries(
      async () => {
        const response = await fetch(url, {
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
          throw new QboApiError(`${method} ${url} -> ${response.status}`, response.status, json);
        }
        return json as T;
      },
      {
        // Retry throttles and transient server errors; never retry 4xx business
        // failures — a blind retry on those is how duplicates get created.
        isRetryable: (error) =>
          error instanceof QboApiError && (error.status === 429 || error.status >= 500),
      },
    );
  }
}
