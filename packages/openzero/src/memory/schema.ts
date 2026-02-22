/**
 * Structured memory schema for rich, typed memory storage.
 * These types define the format for memories extracted from conversations.
 */

export namespace MemorySchema {
  /**
   * Memory type discriminator
   */
  export type MemoryType = "workflow" | "preference" | "bug_fix" | "architecture" | "config" | "fact"

  /**
   * Base structure for all memory types
   */
  export interface BaseMemory {
    type: MemoryType
    summary: string // Brief one-line description
    details?: string // Rich contextual information
    keywords?: string[] // For search boosting
    context?: string // When/why this is relevant
  }

  /**
   * Workflow memory: repeatable processes, commands, or sequences
   */
  export interface WorkflowMemory extends BaseMemory {
    type: "workflow"
    command?: string // The actual command or code
    trigger?: string // What prompts this workflow
    dependencies?: string[] // Prerequisites or requirements
  }

  /**
   * Preference memory: user style, tool choices, coding patterns
   */
  export interface PreferenceMemory extends BaseMemory {
    type: "preference"
    category?: "coding_style" | "tools" | "formatting" | "testing" | "other"
    examples?: string[] // Concrete examples of the preference
  }

  /**
   * Bug fix memory: problems solved and their solutions
   */
  export interface BugFixMemory extends BaseMemory {
    type: "bug_fix"
    symptom: string // What the problem looked like
    rootCause?: string // Why it happened
    solution: string // How it was fixed
    preventionTips?: string // How to avoid in future
  }

  /**
   * Architecture memory: design decisions, system structure
   */
  export interface ArchitectureMemory extends BaseMemory {
    type: "architecture"
    decision: string // What was decided
    rationale?: string // Why this approach
    alternatives?: string[] // What was considered and rejected
    tradeoffs?: string // Pros/cons of the decision
  }

  /**
   * Config memory: environment setup, settings, configurations
   */
  export interface ConfigMemory extends BaseMemory {
    type: "config"
    location?: string // File path or config location
    setting: string // What is configured
    value?: string // The config value
    purpose?: string // Why this config exists
  }

  /**
   * Generic fact memory: anything that doesn't fit other categories
   */
  export interface FactMemory extends BaseMemory {
    type: "fact"
    // Just summary and details from base
  }

  /**
   * Union type of all memory types
   */
  export type StructuredMemory =
    | WorkflowMemory
    | PreferenceMemory
    | BugFixMemory
    | ArchitectureMemory
    | ConfigMemory
    | FactMemory

  /**
   * Legacy plain-string memory format (for backward compatibility)
   */
  export interface LegacyMemory {
    type: "legacy"
    text: string
  }

  /**
   * Any valid memory format
   */
  export type AnyMemory = StructuredMemory | LegacyMemory | string

  /**
   * Format a structured memory for display to the AI
   */
  export function format(memory: AnyMemory): string {
    // Handle legacy string format
    if (typeof memory === "string") {
      return memory
    }

    // Handle legacy object format
    if ("text" in memory) {
      return memory.text
    }

    // Format structured memory
    const parts: string[] = [memory.summary]

    // Add type-specific details
    switch (memory.type) {
      case "workflow":
        if (memory.command) parts.push(`Command: \`${memory.command}\``)
        if (memory.trigger) parts.push(`Trigger: ${memory.trigger}`)
        if (memory.dependencies?.length) parts.push(`Requires: ${memory.dependencies.join(", ")}`)
        break

      case "bug_fix":
        parts.push(`Problem: ${memory.symptom}`)
        if (memory.rootCause) parts.push(`Cause: ${memory.rootCause}`)
        parts.push(`Solution: ${memory.solution}`)
        if (memory.preventionTips) parts.push(`Prevention: ${memory.preventionTips}`)
        break

      case "architecture":
        parts.push(`Decision: ${memory.decision}`)
        if (memory.rationale) parts.push(`Rationale: ${memory.rationale}`)
        if (memory.alternatives?.length) parts.push(`Alternatives considered: ${memory.alternatives.join(", ")}`)
        if (memory.tradeoffs) parts.push(`Tradeoffs: ${memory.tradeoffs}`)
        break

      case "config":
        parts.push(`Setting: ${memory.setting}`)
        if (memory.location) parts.push(`Location: ${memory.location}`)
        if (memory.value) parts.push(`Value: ${memory.value}`)
        if (memory.purpose) parts.push(`Purpose: ${memory.purpose}`)
        break

      case "preference":
        if (memory.category) parts.push(`Category: ${memory.category}`)
        if (memory.examples?.length) parts.push(`Examples: ${memory.examples.join("; ")}`)
        break

      case "fact":
        // Just use summary + details
        break
    }

    // Add generic details and context
    if (memory.details) parts.push(memory.details)
    if (memory.context) parts.push(`Context: ${memory.context}`)

    return parts.join(" | ")
  }

  /**
   * Parse memory string/object into structured format
   * Handles both legacy (plain string) and new (structured) formats
   */
  export function parse(data: string | Record<string, any>): AnyMemory {
    // If it's a string, return as-is (legacy format)
    if (typeof data === "string") {
      return data
    }

    // If it has a 'type' field matching our schema, it's structured
    if (data.type && ["workflow", "preference", "bug_fix", "architecture", "config", "fact"].includes(data.type)) {
      return data as StructuredMemory
    }

    // If it has a 'text' field, it's legacy object format
    if (data.text && typeof data.text === "string") {
      return { type: "legacy", text: data.text }
    }

    // Otherwise, treat as legacy plain text (convert to string)
    return JSON.stringify(data)
  }

  /**
   * Check if a memory is structured (vs legacy plain text)
   */
  export function isStructured(memory: AnyMemory): memory is StructuredMemory {
    return (
      typeof memory === "object" &&
      "type" in memory &&
      memory.type !== "legacy" &&
      ["workflow", "preference", "bug_fix", "architecture", "config", "fact"].includes(memory.type)
    )
  }
}
