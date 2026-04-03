import nodemailer from "nodemailer"

export interface AlertConfig {
  email?: {
    host: string
    port: number
    user: string
    pass: string
    from: string
    to: string[]
    secure?: boolean
  }
  console?: boolean
  prefix?: string
}

export interface AlertSignal {
  title: string
  message: string
  level: "info" | "warning" | "critical"
  timestamp?: number
  meta?: Record<string, unknown>
}

export class AlertService {
  constructor(private cfg: AlertConfig) {}

  private async sendEmail(signal: AlertSignal) {
    if (!this.cfg.email) return
    const { host, port, user, pass, from, to, secure } = this.cfg.email
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: secure ?? (port === 465), // auto-enable TLS if port 465
      auth: { user, pass },
    })

    const ts = new Date(signal.timestamp ?? Date.now()).toISOString()
    await transporter.sendMail({
      from,
      to,
      subject: `[${signal.level.toUpperCase()}] ${signal.title}`,
      text: `${this.cfg.prefix ? `[${this.cfg.prefix}] ` : ""}${signal.message}\n\nTime: ${ts}`,
    })
  }

  private logConsole(signal: AlertSignal) {
    if (!this.cfg.console) return
    const ts = new Date(signal.timestamp ?? Date.now()).toISOString()
    const prefix = this.cfg.prefix ? `[${this.cfg.prefix}]` : ""
    const meta = signal.meta ? `\nmeta: ${JSON.stringify(signal.meta)}` : ""
    const out = `[AlertService][${signal.level.toUpperCase()}] ${prefix} ${signal.title}\n${signal.message}\n${ts}${meta}`
    if (signal.level === "critical") {
      console.error(out)
    } else if (signal.level === "warning") {
      console.warn(out)
    } else {
      console.log(out)
    }
  }

  async dispatch(signals: AlertSignal[]) {
    for (const sig of signals) {
      try {
        await this.sendEmail(sig)
      } catch (e: any) {
        console.error(`[AlertService] Failed to send email: ${e?.message ?? e}`)
      }
      this.logConsole(sig)
    }
  }
}
