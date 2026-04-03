import type { TokenMetrics } from "./tokenAnalysisCalculator"

export interface IframeConfig {
  containerId: string
  srcUrl: string
  metrics: TokenMetrics
  refreshIntervalMs?: number
  /** Explicit target origin for postMessage; defaults to origin derived from srcUrl */
  targetOrigin?: string
  /** If true, waits for a READY message from iframe before sending metrics */
  waitForReady?: boolean
  /** Enable console.debug logs */
  debug?: boolean
}

type ParentToChildMsg =
  | { type: "TOKEN_ANALYSIS_INIT"; payload: { metrics: TokenMetrics } }
  | { type: "TOKEN_ANALYSIS_METRICS"; payload: TokenMetrics }

type ChildToParentMsg = { type: "TOKEN_ANALYSIS_READY" } | { type: "TOKEN_ANALYSIS_ACK" }

export class TokenAnalysisIframe {
  private iframeEl: HTMLIFrameElement | null = null
  private refreshTimer: number | null = null
  private targetOrigin: string = "*"
  private ready = false
  private boundOnMessage = (e: MessageEvent<ChildToParentMsg>) => this.onMessage(e)

  constructor(private config: IframeConfig) {}

  init(): void {
    const container = document.getElementById(this.config.containerId)
    if (!container) throw new Error("Container not found: " + this.config.containerId)

    // derive target origin from srcUrl if not provided
    try {
      const url = new URL(this.config.srcUrl, window.location.href)
      this.targetOrigin = this.config.targetOrigin ?? url.origin
    } catch {
      this.targetOrigin = this.config.targetOrigin ?? "*"
    }

    const iframe = document.createElement("iframe")
    iframe.src = this.config.srcUrl
    iframe.width = "100%"
    iframe.height = "100%"
    iframe.setAttribute("frameborder", "0")
    iframe.setAttribute("allow", "clipboard-read; clipboard-write")
    iframe.onload = () => {
      this.log("iframe loaded")
      if (!this.config.waitForReady) {
        this.ready = true
        this.postInit()
      }
    }

    container.appendChild(iframe)
    this.iframeEl = iframe

    window.addEventListener("message", this.boundOnMessage)

    if (this.config.refreshIntervalMs && this.config.refreshIntervalMs > 0) {
      this.setRefreshInterval(this.config.refreshIntervalMs)
    }
  }

  /** Update metrics and push to iframe immediately if connected */
  updateMetrics(metrics: TokenMetrics): void {
    this.config.metrics = metrics
    this.postMetrics()
  }

  /** Change or clear refresh interval */
  setRefreshInterval(ms?: number): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
    if (ms && ms > 0) {
      this.refreshTimer = window.setInterval(() => this.postMetrics(), ms)
    }
  }

  /** Gracefully remove iframe and listeners */
  destroy(): void {
    this.setRefreshInterval(undefined)
    window.removeEventListener("message", this.boundOnMessage)
    if (this.iframeEl?.parentElement) {
      this.iframeEl.parentElement.removeChild(this.iframeEl)
    }
    this.iframeEl = null
    this.ready = false
  }

  // ---------------- internals ----------------

  private postInit(): void {
    if (!this.iframeEl?.contentWindow) return
    const msg: ParentToChildMsg = {
      type: "TOKEN_ANALYSIS_INIT",
      payload: { metrics: this.config.metrics },
    }
    this.iframeEl.contentWindow.postMessage(msg, this.targetOrigin)
    this.log("sent INIT", msg)
  }

  private postMetrics(): void {
    if (!this.ready || !this.iframeEl?.contentWindow) return
    const msg: ParentToChildMsg = {
      type: "TOKEN_ANALYSIS_METRICS",
      payload: this.config.metrics,
    }
    this.iframeEl.contentWindow.postMessage(msg, this.targetOrigin)
    this.log("sent METRICS", msg)
  }

  private onMessage(event: MessageEvent<ChildToParentMsg>): void {
    // origin check if we have a specific one
    if (this.targetOrigin !== "*" && event.origin !== this.targetOrigin) return
    if (!event.data || typeof event.data !== "object") return

    const { type } = event.data
    if (type === "TOKEN_ANALYSIS_READY") {
      this.log("received READY")
      this.ready = true
      this.postInit()
    } else if (type === "TOKEN_ANALYSIS_ACK") {
      this.log("received ACK")
      // no-op but can be used for backpressure handling
    }
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      // eslint-disable-next-line no-console
      console.debug("[TokenAnalysisIframe]", ...args)
    }
  }
}
