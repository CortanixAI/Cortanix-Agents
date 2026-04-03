export interface SightCoreConfig {
  url: string
  protocols?: string[]
  /** Base delay before first reconnect attempt in ms */
  reconnectIntervalMs?: number
  /** Maximum delay cap for exponential backoff in ms */
  reconnectMaxIntervalMs?: number
  /** Optional limit for consecutive reconnect attempts; set 0 or undefined for infinite */
  maxReconnectAttempts?: number
  /** Send a heartbeat ping every N ms; disabled if undefined */
  heartbeatIntervalMs?: number
}

export type SightCoreMessage = {
  topic: string
  payload: unknown
  timestamp: number
}

type MessageHandler = (msg: SightCoreMessage) => void
type VoidHandler = () => void
type ErrorHandler = (err: Event) => void

export class SightCoreWebSocket {
  private socket?: WebSocket
  private readonly url: string
  private readonly protocols?: string[]
  private readonly reconnectBase: number
  private readonly reconnectCap: number
  private readonly maxReconnects?: number
  private readonly heartbeatEvery?: number

  private reconnectAttempts = 0
  private shouldReconnect = true
  private heartbeatTimer?: number
  private lastPongAt = 0

  private onMessageGlobal?: MessageHandler
  private onOpenCb?: VoidHandler
  private onCloseCb?: VoidHandler
  private onErrorCb?: ErrorHandler

  /** Queue messages while not open */
  private outbox: string[] = []
  /** Per-topic listeners */
  private topicHandlers = new Map<string, Set<MessageHandler>>()

  constructor(config: SightCoreConfig) {
    this.url = config.url
    this.protocols = config.protocols
    this.reconnectBase = Math.max(100, config.reconnectIntervalMs ?? 1000)
    this.reconnectCap = Math.max(this.reconnectBase, config.reconnectMaxIntervalMs ?? 15000)
    this.maxReconnects = config.maxReconnectAttempts
    this.heartbeatEvery = config.heartbeatIntervalMs
  }

  /**
   * Connect and set global handlers. Safe to call multiple times; will reuse config.
   */
  connect(
    onMessage: MessageHandler,
    onOpen?: VoidHandler,
    onClose?: VoidHandler,
    onError?: ErrorHandler
  ): void {
    this.onMessageGlobal = onMessage
    this.onOpenCb = onOpen
    this.onCloseCb = onClose
    this.onErrorCb = onError

    this.shouldReconnect = true
    this.openSocket()
  }

  /** Register a handler for a specific topic */
  on(topic: string, handler: MessageHandler): () => void {
    const set = this.topicHandlers.get(topic) ?? new Set<MessageHandler>()
    set.add(handler)
    this.topicHandlers.set(topic, set)
    return () => {
      const s = this.topicHandlers.get(topic)
      if (!s) return
      s.delete(handler)
      if (s.size === 0) this.topicHandlers.delete(topic)
    }
  }

  /** Send a typed message; queues if socket is not open yet */
  send(topic: string, payload: unknown): void {
    const msg = JSON.stringify({ topic, payload, timestamp: Date.now() })
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(msg)
    } else {
      this.outbox.push(msg)
    }
  }

  /** Gracefully close and stop all reconnect attempts */
  disconnect(code?: number, reason?: string): void {
    this.shouldReconnect = false
    this.clearHeartbeat()
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close(code, reason)
    } else if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
      // Best effort: remove handlers to avoid triggering reconnect twice
      this.socket.onclose = null as any
      this.socket.onerror = null as any
      this.socket.close(code, reason)
    }
    this.socket = undefined
  }

  /** Whether the underlying socket is currently open */
  get isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  // ----------------- internals -----------------

  private openSocket(): void {
    // Respect max reconnect attempts
    if (this.maxReconnects !== undefined && this.reconnectAttempts > this.maxReconnects) {
      return
    }

    this.socket = this.protocols
      ? new WebSocket(this.url, this.protocols)
      : new WebSocket(this.url)

    this.attachHandlers()
  }

  private attachHandlers(): void {
    if (!this.socket) return

    this.socket.onopen = () => {
      this.reconnectAttempts = 0
      // Flush queued messages
      if (this.outbox.length) {
        for (const msg of this.outbox) this.socket!.send(msg)
        this.outbox = []
      }
      this.startHeartbeat()
      this.onOpenCb?.()
    }

    this.socket.onmessage = event => {
      // Heartbeat pong (string "pong" or {"type":"pong"})
      if (typeof event.data === "string") {
        if (event.data === "pong") {
          this.lastPongAt = Date.now()
          return
        }
        try {
          const parsed = JSON.parse(event.data) as unknown
          const msg = this.normalizeMessage(parsed)
          if (!msg) return
          // Global handler
          this.onMessageGlobal?.(msg)
          // Topic-specific handlers
          const handlers = this.topicHandlers.get(msg.topic)
          if (handlers) {
            for (const h of handlers) h(msg)
          }
        } catch {
          // ignore invalid json
        }
      }
    }

    this.socket.onerror = (ev: Event) => {
      this.onErrorCb?.(ev)
      // Close to trigger onclose flow
      try {
        this.socket?.close()
      } catch {
        // ignore
      }
    }

    this.socket.onclose = () => {
      this.clearHeartbeat()
      this.onCloseCb?.()
      if (this.shouldReconnect) {
        this.scheduleReconnect()
      }
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts += 1
    if (this.maxReconnects !== undefined && this.reconnectAttempts > this.maxReconnects) {
      return
    }
    const delay = Math.min(
      this.reconnectCap,
      this.reconnectBase * Math.pow(2, this.reconnectAttempts - 1)
    )
    setTimeout(() => {
      if (!this.shouldReconnect) return
      this.openSocket()
    }, delay)
  }

  /** Basic message shape validation and normalization */
  private normalizeMessage(input: any): SightCoreMessage | null {
    if (!input || typeof input !== "object") return null
    const topic = typeof input.topic === "string" ? input.topic : undefined
    const payload = "payload" in input ? input.payload : undefined
    const timestampRaw =
      typeof input.timestamp === "number"
        ? input.timestamp
        : typeof input.timestamp === "string"
        ? Number(input.timestamp)
        : NaN

    if (!topic) return null
    const timestamp = Number.isFinite(timestampRaw) ? Number(timestampRaw) : Date.now()
    return { topic, payload, timestamp }
  }

  private startHeartbeat(): void {
    if (!this.heartbeatEvery) return
    this.clearHeartbeat()
    this.lastPongAt = Date.now()
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
      try {
        // Send ping – server should respond with 'pong' or a pong frame routed to onmessage
        this.socket.send("ping")
      } catch {
        // ignore
      }
      // If no pong received within 2 heartbeat intervals, force reconnect
      const now = Date.now()
      if (now - this.lastPongAt > this.heartbeatEvery * 2) {
        try {
          this.socket.close()
        } catch {
          // ignore
        }
      }
    }, this.heartbeatEvery)
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
  }
}
