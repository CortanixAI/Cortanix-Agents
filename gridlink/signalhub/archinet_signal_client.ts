export interface Signal {
  id: string
  type: string
  timestamp: number
  payload: Record<string, any>
}

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

export interface SignalApiClientOptions {
  apiKey?: string
  timeoutMs?: number                 // per-request timeout
  defaultHeaders?: Record<string, string>
  retry?: {
    attempts: number                 // total attempts including the first one
    backoffMs: number                // base backoff in ms
    multiplier: number               // growth factor (>= 1), deterministic (no randomness)
    maxBackoffMs?: number            // optional cap
  }
}

/**
 * Simple HTTP client for signals with:
 * - configurable timeouts
 * - deterministic retries (no randomness)
 * - AbortController cancellation
 * - query helpers and pagination
 * - centralized error parsing
 */
export class SignalApiClient {
  private readonly baseUrl: string
  private readonly apiKey?: string
  private readonly timeoutMs: number
  private readonly defaultHeaders: Record<string, string>
  private readonly retryCfg: Required<SignalApiClientOptions["retry"]>

  constructor(baseUrl: string, opts: SignalApiClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "") // strip trailing slash
    this.apiKey = opts.apiKey
    this.timeoutMs = Math.max(0, opts.timeoutMs ?? 20_000)
    this.defaultHeaders = {
      "Content-Type": "application/json",
      ...(opts.defaultHeaders ?? {}),
    }
    const retry = opts.retry ?? { attempts: 1, backoffMs: 300, multiplier: 2, maxBackoffMs: 10_000 }
    this.retryCfg = {
      attempts: Math.max(1, retry.attempts),
      backoffMs: Math.max(0, retry.backoffMs),
      multiplier: Math.max(1, retry.multiplier),
      maxBackoffMs: Math.max(0, retry.maxBackoffMs ?? 10_000),
    }
  }

  // ------------------------------- Public API --------------------------------

  /** Fetch all signals (not recommended for very large datasets) */
  async fetchAllSignals(): Promise<ApiResponse<Signal[]>> {
    return this.requestJson<Signal[]>("GET", "/signals")
  }

  /** Fetch a single signal by id */
  async fetchSignalById(id: string): Promise<ApiResponse<Signal>> {
    return this.requestJson<Signal>("GET", `/signals/${encodeURIComponent(id)}`)
  }

  /**
   * List signals with optional filters & pagination
   * Example cursor usage depends on the server API (e.g., next page token)
   */
  async listSignals(params?: {
    type?: string
    since?: number
    until?: number
    limit?: number
    cursor?: string
  }): Promise<ApiResponse<{ items: Signal[]; nextCursor?: string }>> {
    const query = this.toQuery(params)
    return this.requestJson<{ items: Signal[]; nextCursor?: string }>("GET", "/signals", undefined, query)
  }

  /** Health check endpoint (if server provides it) */
  async health(): Promise<ApiResponse<{ ok: true }>> {
    return this.requestJson<{ ok: true }>("GET", "/health")
  }

  // ------------------------------ Internals ----------------------------------

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { ...this.defaultHeaders }
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`
    return headers
  }

  private buildUrl(path: string, query?: URLSearchParams | Record<string, string | number | undefined>): string {
    const url = new URL(this.baseUrl + path)
    if (query instanceof URLSearchParams) {
      url.search = query.toString()
    } else if (query && typeof query === "object") {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue
        url.searchParams.set(k, String(v))
      }
    }
    return url.toString()
  }

  private toQuery(params?: Record<string, unknown>): Record<string, string> | undefined {
    if (!params) return undefined
    const q: Record<string, string> = {}
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue
      q[k] = String(v)
    }
    return q
  }

  private async requestJson<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>
  ): Promise<ApiResponse<T>> {
    const url = this.buildUrl(path, query as any)
    const init: RequestInit = {
      method,
      headers: this.getHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }
    try {
      const res = await this.fetchWithRetry(url, init)
      const data = await this.parseJsonSafe<T>(res)
      if (!res.ok) {
        return { success: false, error: this.formatHttpError(res, data) }
      }
      return { success: true, data }
    } catch (err: any) {
      return { success: false, error: err?.message ?? "Request failed" }
    }
  }

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let attempt = 0
    let lastErr: any

    while (attempt < this.retryCfg.attempts) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
      try {
        const res = await fetch(url, { ...init, signal: controller.signal })
        clearTimeout(timeout)

        // Retry for network errors are handled by catch; here consider 429/5xx as retryable
        if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
          lastErr = new Error(`HTTP ${res.status}`)
        } else {
          return res
        }
      } catch (err) {
        lastErr = err
      } finally {
        attempt++
      }

      if (attempt < this.retryCfg.attempts) {
        const delay = Math.min(
          this.retryCfg.backoffMs * Math.pow(this.retryCfg.multiplier, attempt - 1),
          this.retryCfg.maxBackoffMs
        )
        await this.sleep(delay)
      }
    }

    throw (lastErr instanceof Error ? lastErr : new Error("Request failed"))
  }

  private async parseJsonSafe<T>(res: Response): Promise<T | undefined> {
    const ct = res.headers.get("content-type") || ""
    if (!ct.toLowerCase().includes("application/json")) return undefined
    try {
      return (await res.json()) as T
    } catch {
      return undefined
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private formatHttpError(res: Response, data?: unknown): string {
    const status = `HTTP ${res.status}`
    if (data && typeof data === "object") {
      try {
        const msg = JSON.stringify(data)
        return `${status}: ${msg}`
      } catch {
        /* ignore stringify errors */
      }
    }
    return status
  }
}
