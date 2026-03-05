import { Log } from "../util/log"
import { Session } from "."
import { SessionState } from "./state"
import { Provider } from "../provider/provider"
import { Database, eq } from "../storage/db"
import { SessionTable } from "./session.sql"
import { generateText } from "ai"
import { MessageV2 } from "./message-v2"
import { GlobalSettings } from "../global/settings"

/**
 * Async session state updater.
 *
 * Called fire-and-forget after each assistant response (alongside
 * SessionCompression.maybeCompress). Uses the small/cheap LLM to
 * generate an incremental delta against the current state, then
 * merges and persists it to the session row.
 *
 * The delta approach (vs full rewrite) ensures:
 * - Continuity: old decisions are never silently dropped
 * - Efficiency: only changed fields are generated
 * - Accuracy: editing < rewriting from scratch
 */
export namespace SessionStateUpdate {
  const log = Log.create({ service: "session.state-update" })

  /**
   * Trigger an async state update. Fire-and-forget — never blocks the response.
   */
  export function maybeUpdate(input: { sessionID: string; providerID: string }) {
    Promise.resolve()
      .then(() => update(input))
      .catch((error) => {
        log.error("background state update failed", { error, sessionID: input.sessionID })
      })
  }

  async function update(input: { sessionID: string; providerID: string }) {
    const session = await Session.get(input.sessionID)
    const msgs = await Session.messages({ sessionID: input.sessionID, limit: 8 })

    // Need at least one user+assistant exchange to build state
    const hasAssistant = msgs.some((m) => m.info.role === "assistant")
    if (!hasAssistant) return

    const current = session.state_record ? SessionState.deserialize(session.state_record) : SessionState.create()

    const memoryModel = GlobalSettings.getMemoryModel()
    if (!memoryModel) {
      log.warn("memory model not configured, skipping state update")
      return
    }
    const [providerId, modelId] = memoryModel.split("/")
    const small = await Provider.getModel(providerId, modelId)
    if (!small) {
      log.warn("memory model not available", { memoryModel })
      return
    }

    const language = await Provider.getLanguage(small)
    const exchange = formatExchange(msgs)

    const prompt = buildPrompt(current, exchange)

    const result = await generateText({ model: language, prompt }).catch((error) => {
      log.error("state update LLM call failed", { error })
      return undefined
    })
    if (!result) return

    const delta = parseDelta(result.text)
    if (!delta) {
      log.warn("state update: failed to parse delta from LLM output")
      return
    }

    const updated = SessionState.apply(current, delta)
    const serialized = SessionState.serialize(updated)

    Database.use((db) => {
      db.update(SessionTable).set({ state_record: serialized }).where(eq(SessionTable.id, input.sessionID)).run()
    })

    log.debug("state record updated", { sessionID: input.sessionID })
  }

  /**
   * Format the last few messages into a compact exchange string.
   * Tool calls are condensed to name+status only to save tokens.
   */
  function formatExchange(msgs: MessageV2.WithParts[]): string {
    return msgs
      .map((msg) => {
        const role = msg.info.role === "assistant" ? "A" : "U"
        const parts = msg.parts
          .map((p) => {
            if (p.type === "text") return p.text.slice(0, 600)
            if (p.type === "tool") return `[tool:${p.tool} status:${p.state.status}]`
            return ""
          })
          .filter(Boolean)
          .join(" ")
        return `${role}: ${parts}`
      })
      .join("\n\n")
  }

  /**
   * Build the delta-generation prompt.
   *
   * The format is intentionally terse to minimise output tokens.
   * The LLM only emits lines for fields that actually changed.
   *
   * Output format (one field per line, all optional):
   *   TASK: <1-2 sentence description>
   *   +DECISION: <new decision>
   *   -DECISION: <exact decision text to remove>
   *   +PROGRESS: <completed step>
   *   +BLOCKER: <new blocker>
   *   -BLOCKER: <exact blocker text to remove>
   *   NEXT: <step1> | <step2> | <step3>
   *   CONTEXT: <free-form important details>
   */
  function buildPrompt(state: SessionState.State, exchange: string): string {
    const stateBlock = SessionState.hasContent(state)
      ? `Current state:\nTASK: ${state.task}\nDECISIONS: ${state.decisions.join("; ") || "none"}\nPROGRESS: ${state.progress.slice(-5).join("; ") || "none"}\nBLOCKERS: ${state.blockers.join("; ") || "none"}\nNEXT: ${state.next.join(" | ") || "none"}\nCONTEXT: ${state.context || "none"}`
      : "Current state: (empty — first turn)"

    return `You are a session-state tracker. Update only the fields that changed based on the conversation excerpt below.

${stateBlock}

Recent conversation:
${exchange}

Output ONLY changed fields using this exact format (omit unchanged fields):
TASK: <1-2 sentences on what is being worked on>
+DECISION: <a new locked-in decision>
-DECISION: <exact text of a decision to remove>
+PROGRESS: <a completed step>
+BLOCKER: <a new open question or blocker>
-BLOCKER: <exact text of a blocker to remove>
NEXT: <step1> | <step2> | <step3>
CONTEXT: <important technical detail to remember>

Rules:
- Omit any line whose field has not changed
- NEXT replaces the entire list (max 5 items separated by |)
- Be concise — total output should be under 200 words
- Do not include explanations or preamble`
  }

  /**
   * Parse the LLM's terse line-by-line output into a Delta.
   */
  function parseDelta(text: string): SessionState.Delta | undefined {
    const delta: SessionState.Delta = {}
    let found = false

    for (const raw of text.split("\n")) {
      const line = raw.trim()
      if (!line) continue

      if (line.startsWith("TASK:")) {
        delta.task = line.slice(5).trim()
        found = true
      } else if (line.startsWith("+DECISION:")) {
        delta.add_decisions = [...(delta.add_decisions ?? []), line.slice(10).trim()]
        found = true
      } else if (line.startsWith("-DECISION:")) {
        delta.remove_decisions = [...(delta.remove_decisions ?? []), line.slice(10).trim()]
        found = true
      } else if (line.startsWith("+PROGRESS:")) {
        delta.add_progress = [...(delta.add_progress ?? []), line.slice(10).trim()]
        found = true
      } else if (line.startsWith("+BLOCKER:")) {
        delta.add_blockers = [...(delta.add_blockers ?? []), line.slice(9).trim()]
        found = true
      } else if (line.startsWith("-BLOCKER:")) {
        delta.remove_blockers = [...(delta.remove_blockers ?? []), line.slice(9).trim()]
        found = true
      } else if (line.startsWith("NEXT:")) {
        delta.next = line
          .slice(5)
          .split("|")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 5)
        found = true
      } else if (line.startsWith("CONTEXT:")) {
        delta.context = line.slice(8).trim()
        found = true
      }
    }

    return found ? delta : undefined
  }
}
