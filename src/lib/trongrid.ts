import { getConfig } from "./config.js";
import { NETWORK_HOSTS } from "./constants.js";
import { getLogger } from "./logger.js";
import { withRetry } from "./retry.js";
import type { TronNetwork } from "./types.js";

export class TronGridError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "TronGridError";
  }
}

interface TronGridClientOptions {
  network?: TronNetwork;
  apiKey?: string;
}

/** HTTP client for TronGrid with rate-limit retry and read dedup cache. */
export class TronGridClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly cache = new Map<string, { expires: number; data: unknown }>();
  private readonly cacheTtlMs = 5_000;

  constructor(options: TronGridClientOptions = {}) {
    const config = getConfig();
    const network = options.network ?? config.NETWORK;
    this.baseUrl = NETWORK_HOSTS[network];
    this.apiKey = options.apiKey ?? config.TRON_GRID_API_KEY;
  }

  get host(): string {
    return this.baseUrl;
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(path.startsWith("http") ? path : `${this.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }
    return this.request<T>(url.toString(), { method: "GET" });
  }

  async post<T>(path: string, body: unknown, useCache = false): Promise<T> {
    const cacheKey = useCache ? `POST:${path}:${JSON.stringify(body)}` : null;
    if (cacheKey) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expires > Date.now()) {
        return cached.data as T;
      }
    }

    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const data = await this.request<T>(url, {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (cacheKey) {
      this.cache.set(cacheKey, { expires: Date.now() + this.cacheTtlMs, data });
    }

    return data;
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const log = getLogger();

    return withRetry(async () => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (this.apiKey) {
        headers["TRON-PRO-API-KEY"] = this.apiKey;
      }

      log.debug({ url, method: init.method }, "TronGrid request");

      const response = await fetch(url, { ...init, headers });

      if (!response.ok) {
        const body = await response.text();
        throw new TronGridError(
          `TronGrid ${response.status}: ${body.slice(0, 200)}`,
          response.status,
          body,
        );
      }

      return (await response.json()) as T;
    });
  }

  /** Paginate TronGrid v1 list endpoints. */
  async paginateV1<T>(
    path: string,
    params: Record<string, string>,
    extract: (page: { data?: T[]; meta?: { fingerprint?: string } }) => T[],
    maxPages = 50,
  ): Promise<T[]> {
    const results: T[] = [];
    let fingerprint: string | undefined;
    let pages = 0;

    while (pages < maxPages) {
      const pageParams = { ...params };
      if (fingerprint) {
        pageParams.fingerprint = fingerprint;
      }

      const page = await this.get<{
        data?: T[];
        meta?: { fingerprint?: string; at?: number };
        success?: boolean;
      }>(path, pageParams);

      const batch = extract(page);
      results.push(...batch);

      fingerprint = page.meta?.fingerprint;
      pages++;
      if (!fingerprint || batch.length === 0) {
        break;
      }
    }

    return results;
  }
}
