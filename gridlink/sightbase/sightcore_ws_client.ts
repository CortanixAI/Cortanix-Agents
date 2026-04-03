export interface SightCoreConfig {
  url: string
  protocols?: string[]
  reconnectIntervalMs?: number         // base delay
  maxReconnectIntervalMs?: number      // cap for backoff
  backoffMultiplier?: number           // growth factor (>= 1)
  heartbeatIntervalMs?: number         // send heartbeat every N ms when connected
  outboxLimit?: number                 // max queued messages before connection opens
}

export type SightCoreMessage = {
  topic: string
  payload: any
  timestamp: number
}

type MessageHandler = (msg: SightCoreMessage) => void
type VoidHandler = () => void
type ErrorHandler = (err: Event | Error) => void

export class SightCoreWebSocket {
  private socket?: WebSocket
  private readonly url: string
  private readonly protocols?: string[]
  private readonly baseReconnect: number
  private readonly maxReconnect: number
  private readonly backoffMultiplier: number
  private readonly heartbeatIntervalMs: number
  private readonly outboxLimit: number

  private reconnectAttempts = 0
  private manualShutdown = false
  private heartbeatTimer?: number
  private outbox: string[] = [] // pre-open message queue

  // listeners
  private onMessageCbs = new Set<MessageHandler>()
  private onOpenCbs = new Set<VoidHandler>()
  private onCloseCbs = new Set<VoidHandler>()
  private onErrorCbs = new Set<ErrorHandler>()

  constructor(config: SightCoreConfig) {
    this.url = config.url
    this.protocols = config.protocols
    this.baseReconnect = Math.max(0, config.reconnectIntervalMs ?? 5_000)
    this.maxReconnect = Math.max(this.baseReconnect, config.maxReconnectIntervalMs ?? 60_000)
    this.backoffMultiplier = Math.max(1, config.backoffMultiplier ?? 2)
    this.heartbeatIntervalMs = Math.max(0, config.heartbeatIntervalMs ?? 25_000)
    this.outboxLimit = Math.max(0, config.outboxLimit ?? 100)
  }

  /**
   * Connect and register temporary handlers
   * You can also attach permanent listeners via addOn* methods
   */
  connect(onMessage?: MessageHandler, onOpen?: VoidHandler, onClose?: VoidHandler, onError?: ErrorHandler): void {
    if (onMessage) this.onMessageCbs.add(onMessage)
    if (onOpen) this.onOpenCbs.add(onOpen)
    if (onClose) this.onCloseCbs.add(onClose)
    if (onError) this.onErrorCbs.add(onError)

    this.manualShutdown = false
    this.openSocket()
  }

  /**
   * Add/remove event listeners (preferred over passing callbacks to connect)
   */
  addOnMessage(cb: MessageHandler): void { this.onMessageCbs.add(cb) }
  removeOnMessage(cb: MessageHandler): void { this.onMessageCbs.delete(cb) }
  addOnOpen(cb: VoidHandler): void { this.onOpenCbs.add(cb) }
  removeOnOpen(cb: VoidHandler): void { this.onOpenCbs.delete(cb) }
  addOnClose(cb: VoidHandler): void { this.onCloseCbs.add(cb) }
  removeOnClose(cb: VoidHandler): void { this.onCloseCbs.delete(cb) }
  addOnError(cb: ErrorHandler): void { this.onErrorCbs.add(cb) }
  removeOnError(cb: ErrorHandler): void { this.onErrorCbs.delete(cb) }

  /**
   * Send a message (queued if not yet open)
   */
  send(topic: string, payload: any): void {
    const msg = JSON.stringify({ topic, payload, timestamp: Date.now() })
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(msg)
      return
    }
    if (this.outbox.length < this.outboxLimit) {
      this.outbox.push(msg)
    } else {
      console.warn("Outbox is full, dropping message")
    }
  }

  /**
   * Convenience helper to send raw already-serialized JSON (advanced)
   */
  sendRaw(json: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(json)
      return
    }
    if (this.outbox.length < this.outboxLimit) {
      this.outbox.push(json)
    } else {
      console.warn("Outbox is full, dropping raw message")
    }
  }

  /**
   * Disconnect and prevent auto-reconnect
   */
  disconnect(): void {
    this.manualShutdown = true
    this.clearHeartbeat()
    this.safeClose()
  }

  /** Current readyState (or undefined if no socket yet) */
  get readyState(): number | undefined {
    return this.socket?.readyState
  }

  /** True if the current socket exists and is OPEN */
  get isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private openSocket(): void {
    this.safeClose() // ensure previous is gone

    this.socket = this.protocols
      ? new WebSocket(this.url, this.protocols)
      : new WebSocket(this.url)

    this.socket.onopen = () => {
      this.reconnectAttempts = 0
      this.startHeartbeat()
      this.flushOutbox()
      this.onOpenCbs.forEach(cb => cb())
    }

    this.socket.onmessage = (event: MessageEvent) => {
      const msg = this.safeParse(event.data)
      if (!msg) return
      // minimal validation
      if (typeof msg.topic !== "string") return
      if (typeof msg.timestamp !== "number") msg.timestamp = Date.now()
      this.onMessageCbs.forEach(cb => cb(msg as SightCoreMessage))
    }

    this.socket.onclose = () => {
      this.clearHeartbeat()
      this.onCloseCbs.forEach(cb => cb())

      if (this.manualShutdown) return
      const delay = this.nextBackoffDelay()
      setTimeout(() => this.openSocket(), delay)
    }

    this.socket.onerror = (evt: Event) => {
      this.onErrorCbs.forEach(cb => cb(evt))
      // let onclose handle the reconnect path
    }
  }

  private flushOutbox(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    for (const msg of this.outbox) {
      this.socket.send(msg)
    }
    this.outbox = []
  }

  private safeParse(data: any): SightCoreMessage | null {
    try {
      if (typeof data === "string") return JSON.parse(data) as SightCoreMessage
      if (data && typeof data === "object") return data as SightCoreMessage
      return null
    } catch {
      return null
    }
  }

  private safeClose(): void {
    if (!this.socket) return
    try {
      if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
        this.socket.close()
      }
    } catch {
      // ignore
    } finally {
      this.socket = undefined
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatIntervalMs <= 0) return
    this.clearHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected) {
        // lightweight heartbeat frame; server may ignore or handle internally
        this.send("__ping__", { t: Date.now() })
      }
    }, this.heartbeatIntervalMs) as unknown as number
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer as unknown as number)
      this.heartbeatTimer = undefined
    }
  }

  private nextBackoffDelay(): number {
    const attempt = this.reconnectAttempts++
    const delay = Math.min(this.baseReconnect * Math.pow(this.backoffMultiplier, attempt), this.maxReconnect)
    return Math.floor(delay) // no randomization per your rules
  }
}
