import { Log } from "../util/log"

/**
 * Session State Record — ephemeral, per-session task context.
 *
 * Solves the context window problem for long (100+ turn) sessions by
 * maintaining a compact structured record of what the LLM is doing,
 * what has been decided, and what comes next.
 *
 * Lifecycle: created on first turn, updated async after each assistant
 * response, injected into system prompt, cleared when session ends.
 *
 * Size guidance (token budget):
 *   simple  task: ~200 tokens
 *   typical task: 500-800 tokens
 *   complex task: up to 1500 tokens
 *
 * Updates use incremental deltas — the small LLM receives the current
 * state + last exchange and outputs ONLY what changed, which is merged
 * here. This prevents drift/hallucination from full rewrites.
 */
export namespace SessionState {
  const log = Log.create({ service: "session.state" })

  export interface State {
    task: string // 1-2 sentences: what we are currently doing
    decisions: string[] // Key choices that have been locked in
    progress: string[] // Completed/validated steps
    blockers: string[] // Open questions or things waiting on user
    next: string[] // Immediate next actions (max 5)
    context: string // Free-form narrative for important details that don't fit above
  }

  /**
   * A delta is the minimal change set output by the small LLM.
   * Each field is optional — only fields that changed are included.
   * Arrays use add/remove instead of replace to preserve continuity.
   */
  export interface Delta {
    task?: string
    add_decisions?: string[]
    remove_decisions?: string[]
    add_progress?: string[]
    add_blockers?: string[]
    remove_blockers?: string[]
    next?: string[]
    context?: string
  }

  export function create(): State {
    return {
      task: "",
      decisions: [],
      progress: [],
      blockers: [],
      next: [],
      context: "",
    }
  }

  /**
   * Apply a delta to an existing state, returning the updated state.
   * Non-destructive: only touches fields present in the delta.
   */
  export function apply(state: State, delta: Delta): State {
    const next = { ...state }

    if (delta.task !== undefined) next.task = delta.task
    if (delta.context !== undefined) next.context = delta.context
    if (delta.next !== undefined) next.next = delta.next.slice(0, 5)

    if (delta.add_decisions?.length) next.decisions = [...state.decisions, ...delta.add_decisions]
    if (delta.remove_decisions?.length)
      next.decisions = state.decisions.filter((d) => !delta.remove_decisions!.includes(d))

    if (delta.add_progress?.length) next.progress = [...state.progress, ...delta.add_progress]

    if (delta.add_blockers?.length) next.blockers = [...state.blockers, ...delta.add_blockers]
    if (delta.remove_blockers?.length) next.blockers = state.blockers.filter((b) => !delta.remove_blockers!.includes(b))

    return next
  }

  export function serialize(state: State): string {
    return JSON.stringify(state)
  }

  export function deserialize(json: string): State {
    try {
      return JSON.parse(json) as State
    } catch {
      log.warn("failed to deserialize state record, starting fresh")
      return create()
    }
  }

  /**
   * Render the state as a compact system-prompt block.
   * Only non-empty fields are included to keep token usage low.
   */
  export function toPrompt(state: State): string {
    const lines: string[] = ["<session-state>"]

    if (state.task) lines.push(`task: ${state.task}`)
    if (state.decisions.length) lines.push(`decisions:\n${state.decisions.map((d) => `- ${d}`).join("\n")}`)
    if (state.progress.length) lines.push(`progress:\n${state.progress.map((p) => `- ${p}`).join("\n")}`)
    if (state.blockers.length) lines.push(`blockers:\n${state.blockers.map((b) => `- ${b}`).join("\n")}`)
    if (state.next.length) lines.push(`next:\n${state.next.map((n) => `- ${n}`).join("\n")}`)
    if (state.context) lines.push(`context: ${state.context}`)

    lines.push("</session-state>")
    return lines.join("\n")
  }

  /**
   * Returns true if the state is non-empty and worth injecting.
   */
  export function hasContent(state: State): boolean {
    return !!(
      state.task ||
      state.decisions.length ||
      state.progress.length ||
      state.blockers.length ||
      state.next.length ||
      state.context
    )
  }
}
