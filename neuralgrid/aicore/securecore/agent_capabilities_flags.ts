export interface AgentCapabilities {
  canAnswerProtocolQuestions: boolean
  canAnswerTokenQuestions: boolean
  canDescribeTooling: boolean
  canReportEcosystemNews: boolean
  canTrackValidators: boolean
  canExplainStaking: boolean
}

export interface AgentFlags {
  requiresExactInvocation: boolean
  noAdditionalCommentary: boolean
  strictMode?: boolean
  logQueries?: boolean
}

export const SOLANA_AGENT_CAPABILITIES: AgentCapabilities = {
  canAnswerProtocolQuestions: true,
  canAnswerTokenQuestions: true,
  canDescribeTooling: true,
  canReportEcosystemNews: true,
  canTrackValidators: true,
  canExplainStaking: true,
}

export const SOLANA_AGENT_FLAGS: AgentFlags = {
  requiresExactInvocation: true,
  noAdditionalCommentary: true,
  strictMode: true,
  logQueries: false,
}

/**
 * Type guard: validate if an object is AgentCapabilities.
 */
export function isAgentCapabilities(obj: any): obj is AgentCapabilities {
  return (
    obj &&
    typeof obj.canAnswerProtocolQuestions === "boolean" &&
    typeof obj.canAnswerTokenQuestions === "boolean" &&
    typeof obj.canDescribeTooling === "boolean" &&
    typeof obj.canReportEcosystemNews === "boolean"
  )
}

/**
 * Merge default capabilities with overrides.
 */
export function createAgentCapabilities(overrides: Partial<AgentCapabilities> = {}): AgentCapabilities {
  return { ...SOLANA_AGENT_CAPABILITIES, ...overrides }
}

/**
 * Merge default flags with overrides.
 */
export function createAgentFlags(overrides: Partial<AgentFlags> = {}): AgentFlags {
  return { ...SOLANA_AGENT_FLAGS, ...overrides }
}
