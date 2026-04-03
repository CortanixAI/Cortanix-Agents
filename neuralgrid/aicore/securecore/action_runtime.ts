import { z } from "zod"

/**
 * Base types for any action.
 */
export type ActionSchema = z.ZodObject<z.ZodRawShape>

export interface ActionResponse<T> {
  status: "ok" | "error"
  notice: string
  data?: T
  error?: string
  meta?: Record<string, unknown>
}

export interface ActionExecuteArgs<S extends ActionSchema, Ctx> {
  payload: z.infer<S>
  context: Ctx
}

/**
 * Contract for an executable action with Zod-validated input.
 */
export interface BaseAction<S extends ActionSchema, R, Ctx = unknown> {
  /** Unique action identifier (stable across versions) */
  id: string
  /** Human-readable description */
  summary: string
  /** Optional semver string (e.g., "1.0.0") */
  version?: string
  /** Zod schema describing the expected payload */
  input: S
  /** Execute the action */
  execute(args: ActionExecuteArgs<S, Ctx>): Promise<ActionResponse<R>>
}

/**
 * Validate an unknown input against a schema, throwing a descriptive error on failure.
 */
export function validatePayload<S extends ActionSchema>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const reason = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")
    const err = new Error(`Invalid payload: ${reason}`)
    // Attach issues for upstream logging if needed
    ;(err as any).issues = parsed.error.issues
    throw err
  }
  return parsed.data
}

/**
 * Helper to run an action safely: wraps execution in try/catch and normalizes the response shape.
 */
export async function runActionSafely<S extends ActionSchema, R, Ctx>(
  action: BaseAction<S, R, Ctx>,
  args: ActionExecuteArgs<S, Ctx>
): Promise<ActionResponse<R>> {
  try {
    // Ensure payload matches the action's schema before execute
    const payload = validatePayload(action.input, args.payload)
    const res = await action.execute({ payload, context: args.context })
    return {
      status: res.error ? "error" : "ok",
      notice: res.notice,
      data: res.data,
      error: res.error,
      meta: res.meta,
    }
  } catch (e: any) {
    return {
      status: "error",
      notice: "Action execution failed",
      error: e?.message ?? String(e),
      meta: { actionId: action.id },
    }
  }
}

/**
 * Factory to create a strongly-typed action object.
 */
export function createAction<S extends ActionSchema, R, Ctx = unknown>(params: {
  id: string
  summary: string
  version?: string
  input: S
  execute: (args: ActionExecuteArgs<S, Ctx>) => Promise<ActionResponse<R>>
}): BaseAction<S, R, Ctx> {
  return {
    id: params.id,
    summary: params.summary,
    version: params.version,
    input: params.input,
    execute: params.execute,
  }
}
