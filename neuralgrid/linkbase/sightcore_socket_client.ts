export interface SightCoreConfig {
  url: string
  protocols?: string[]
  reconnectIntervalMs?: number
  maxReconnectAttempts?: number
  heartbeatIntervalMs?: number
}

export type SightCoreMessage = {
  topic: string
  payload: any
  timestamp: number
}

type MessageHandler = (msg: SightCoreMessage) => void
type VoidHandler = () => void

export class SightCoreWebSocket {
  private socket?: WebSocket
  private readonly url: string
  private readonly protocols?: string[]
  private readonly reconnectInterval: number
  private readonly maxReconnectAttempts?: number
  private readonly heartbeatInterval?: number

  private reconnectAttempts = 0
  private heartbeatTimer?: number

  constructor(config: SightCoreConfig) {
    this.url = config.url
    this.protocols = config.protocols
    this.reconnectInterval = config.reconnectIntervalMs ?? 5000
    this.maxReconnectAttempts = config.maxReconnectAttempts
    this.heartbeatInterval = config.heartbeatIntervalMs
  }

  connect(onMessage: MessageHandler, onOpen?: VoidHandler, onClose?: VoidHandler): void {
    this.socket = this.protocols
      ? new WebSocket(this.url, this.protocols)
      : new WebSocket(this.url)

    this.socket.onopen = () => {
      this.reconnectAttempts = 0
      this.startHeartbeat()
      onOpen?.()
    }

    this.socket.onmessage = event => {
      try {
        const msg = JSON.parse(event.data) as SightCoreMessage
        onMessage(msg)
      } catch {
        // ignore invalid messages
      }
    }

    this.socket.onclose = () => {
      this.stopHeartbeat()
      onClose?.()
      this.tryReconnect(onMessage, onOpen, onClose)
    }

    this.socket.onerror = () => {
      this.socket?.close()
    }
  }

  private tryReconnect(onMessage: MessageHandler, onOpen?: VoidHandler, onClose?: VoidHandler): void {
    this.reconnectAttempts++
    if (this.maxReconnectAttempts && this.reconnectAttempts > this.maxReconnectAttempts) return
    setTimeout(() => this.connect(onMessage, onOpen, onClose), this.reconnectInterval)
  }

  private startHeartbeat(): void {
    if (!this.heartbeatInterval) return
    this.stopHeartbeat()
    this.heartbeatTimer = window.setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: "ping", timestamp: Date.now() }))
      }
    }, this.heartbeatInterval)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
  }

  send(topic: string, payload: any): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      const msg = JSON.stringify({ topic, payload, timestamp: Date.now() })
      this.socket.send(msg)
    }
  }

  disconnect(): void {
    this.stopHeartbeat()
    this.socket?.close()
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }
}
