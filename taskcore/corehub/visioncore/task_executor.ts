/**
 * Simple task executor: registers and runs tasks by name.
 */
type Handler = (params: any) => Promise<any>

export interface ExecutionResult {
  id: string
  result?: any
  error?: string
  startedAt: number
  finishedAt: number
  durationMs: number
}

export class ExecutionEngine {
  private handlers: Record<string, Handler> = {}
  private queue: Array<{ id: string; type: string; params: any }> = []
  private history: ExecutionResult[] = []

  /** Register a handler for a task type */
  register(type: string, handler: Handler): void {
    this.handlers[type] = handler
  }

  /** Add a task to the queue */
  enqueue(id: string, type: string, params: any): void {
    if (!this.handlers[type]) throw new Error(`No handler for ${type}`)
    this.queue.push({ id, type, params })
  }

  /** Run all queued tasks sequentially */
  async runAll(): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = []
    while (this.queue.length) {
      const task = this.queue.shift()!
      const startedAt = Date.now()
      try {
        const data = await this.handlers[task.type](task.params)
        const finishedAt = Date.now()
        const res: ExecutionResult = {
          id: task.id,
          result: data,
          startedAt,
          finishedAt,
          durationMs: finishedAt - startedAt,
        }
        results.push(res)
        this.history.push(res)
      } catch (err: any) {
        const finishedAt = Date.now()
        const res: ExecutionResult = {
          id: task.id,
          error: err?.message ?? String(err),
          startedAt,
          finishedAt,
          durationMs: finishedAt - startedAt,
        }
        results.push(res)
        this.history.push(res)
      }
    }
    return results
  }

  /** Retrieve execution history */
  getHistory(): ExecutionResult[] {
    return [...this.history]
  }

  /** Clear execution history */
  clearHistory(): void {
    this.history = []
  }

  /** Reset both queue and history */
  reset(): void {
    this.queue = []
    this.history = []
  }
}
