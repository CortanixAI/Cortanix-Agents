export interface SightCoreConfig {
  url: string
  protocols?: string[]
  reconnectIntervalMs?: number
  maxReconnectAttempts?: number
}

export interface SightCoreMessage {
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
  private readonly maxReconnectAttempts: number
  private reconnectAttempts = 0
  private isManuallyClosed = false

  constructor(config: SightCoreConfig) {
    this.url = config.url
    this.protocols = config.protocols
    this.reconnectInterval = config.reconnectIntervalMs ?? 5000
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? Infinity
  }

  connect(onMessage: MessageHandler, onOpen?: VoidHandler, onClose?: VoidHandler, onError?: (err: any) => void): void {
    this.isManuallyClosed = false

    this.socket = this.protocols
      ? new WebSocket(this.url, this.protocols)
      : new WebSocket(this.url)

    this.socket.onopen = () => {
      this.reconnectAttempts = 0
      onOpen?.()
    }

    this.socket.onmessage = event => {
      try {
        const msg = JSON.parse(event.data) as SightCoreMessage
        if (msg && msg.topic) {
          onMessage(msg)
        }
      } catch (err) {
        // ignore invalid messages, but optionally log
        console.warn("[SightCoreWebSocket] Invalid message:", err)
      }
    }

    this.socket.onclose = () => {
      onClose?.()
      if (!this.isManuallyClosed && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++
        setTimeout(() => this.connect(onMessage, onOpen, onClose, onError), this.reconnectInterval)
      }
    }

    this.socket.onerror = err => {
      onError?.(err)
      this.socket?.close()
    }
  }

  send(topic: string, payload: any): boolean {
    if (this.socket?.readyState === WebSocket.OPEN) {
      const msg: SightCoreMessage = { topic, payload, timestamp: Date.now() }
      this.socket.send(JSON.stringify(msg))
      return true
    }
    return false
  }

  disconnect(): void {
    this.isManuallyClosed = true
    this.socket?.close()
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }
}
