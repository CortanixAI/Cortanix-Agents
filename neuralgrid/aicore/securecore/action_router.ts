import type { BaseAction, ActionResponse } from "./action_contracts"
import { z } from "zod"

interface AgentContext {
  apiEndpoint: string
  apiKey: string
}

/**
 * Generic Agent: registers Zod-typed actions and routes invocations to them
 * Provides safe invocation utilities and basic registry management
 */
export class Agent {
  private actions = new Map<string, BaseAction<any, any, AgentContext>>()

  /** Register (or replace) an action by its id */
  register<S extends z.ZodObject<z.ZodRawShape>, R>(
    action: BaseAction<S, R, AgentContext>
  ): void {
    this.actions.set(action.id, action as BaseAction<any, any, AgentContext>)
  }

  /** Remove an action by id */
  unregister(actionId: string): boolean {
    return this.actions.delete(actionId)
  }

  /** Check if an action is registered */
  hasAction(actionId: string): boolean {
    return this.actions.has(actionId)
  }

  /** Number of registered actions */
  get size(): number {
    return this.actions.size
  }

  /** List action ids */
  listActionIds(): string[] {
    return Array.from(this.actions.keys())
  }

  /** Remove all actions */
  clear(): void {
    this.actions.clear()
  }

  /**
   * Invoke an action; validates payload against the action's Zod schema
   * Throws on unknown action or validation/execute errors
   */
  async invoke<R, S extends z.ZodObject<z.ZodRawShape> = any>(
    actionId: string,
    payload: unknown,
    ctx: AgentContext
  ): Promise<ActionResponse<R>> {
    const action = this.actions.get(actionId) as BaseAction<S, R, AgentContext> | undefined
    if (!action) throw new Error(`Unknown action "${actionId}"`)
    const parsed = this.validatePayload(action.input, payload)
    return action.execute({ payload: parsed, context: ctx })
  }

  /**
   * Safe variant of invoke: never throws; returns normalized error response instead
   */
  async invokeSafe<R, S extends z.ZodObject<z.ZodRawShape> = any>(
    actionId: string,
    payload: unknown,
    ctx: AgentContext
  ): Promise<ActionResponse<R>> {
    try {
      const res = await this.invoke<R, S>(actionId, payload, ctx)
      // Ensure minimal shape
      return {
        status: res.status ?? "ok",
        notice: res.notice ?? "ok",
        data: res.data,
        error: res.error,
        meta: res.meta,
      }
    } catch (e: any) {
      return {
        status: "error",
        notice: "Agent invocation failed",
        error: e?.message ?? String(e),
        meta: { actionId },
      }
    }
  }

  // ----------------- internals -----------------

  private validatePayload<S extends z.ZodObject<z.ZodRawShape>>(
    schema: S,
    input: unknown
  ): z.infer<S> {
    const parsed = schema.safeParse(input)
    if (!parsed.success) {
      const details = parsed.error.issues
        .map(i => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ")
      const err = new Error(`Invalid payload: ${details}`)
      ;(err as any).issues = parsed.error.issues
      throw err
    }
    return parsed.data
  }
}
