import { Log } from "../util/log"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import { Token } from "../util/token"
import { Provider } from "../provider/provider"
import { streamText } from "ai"

/**
 * Gradual history compression inspired by Agent Zero's approach.
 * Runs asynchronously after each turn to keep context manageable.
 *
 * NOTE: This is a placeholder for future gradual compression.
 * Currently disabled - needs schema changes to add historySummary field.
 */
export namespace SessionCompression {
  const log = Log.create({ service: "session.compression" })

  // Token allocation ratios (similar to Agent Zero)
  const RECENT_MESSAGES_RATIO = 0.6 // Keep 60% for recent raw messages
  const HISTORY_SUMMARY_RATIO = 0.3 // Use 30% for compressed history summary
  const BUFFER_RATIO = 0.1 // Leave 10% buffer

  // Keep at least this many recent messages raw (regardless of token count)
  const MIN_RECENT_MESSAGES = 5

  interface CompressionConfig {
    sessionID: string
    contextLimit: number // Total context window in tokens
  }

  /**
   * Check if session needs compression and trigger it asynchronously.
   * Called after each assistant response.
   *
   * TODO: Enable once historySummary schema is added
   */
  export async function maybeCompress(input: { sessionID: string; model: Provider.Model }) {
    // Disabled until schema changes are made
    return

    /* const contextLimit = input.model.limit.context
    if (contextLimit === 0) return // Model has no limit

    // Run compression in background - don't block the response
    Promise.resolve()
      .then(() => compress({ sessionID: input.sessionID, contextLimit }))
      .catch((error) => {
        log.error("background compression failed", { error, sessionID: input.sessionID })
      }) */
  }

  /**
   * Compress old messages into history summary if needed.
   *
   * TODO: Implement once historySummary field exists in Session schema
   */
  async function compress(config: CompressionConfig) {
    const messages = await Session.messages({ sessionID: config.sessionID })
    if (messages.length < MIN_RECENT_MESSAGES + 2) return // Not enough to compress

    // TODO: Get session and historySummary field (needs schema change)
    // const session = await Session.getInfo(config.sessionID)
    // if (!session) return

    // Calculate current token usage
    const currentTokens = await estimateSessionTokens(messages, undefined)

    // Calculate thresholds
    const recentLimit = Math.floor(config.contextLimit * RECENT_MESSAGES_RATIO)
    const summaryLimit = Math.floor(config.contextLimit * HISTORY_SUMMARY_RATIO)

    // If we're under the threshold, no compression needed
    if (currentTokens < recentLimit + summaryLimit) return

    log.info("compressing session history", {
      sessionID: config.sessionID,
      currentTokens,
      threshold: recentLimit + summaryLimit,
      messageCount: messages.length,
    })

    // Keep recent messages, compress the rest
    const recentMessages = messages.slice(-MIN_RECENT_MESSAGES)
    const oldMessages = messages.slice(0, -MIN_RECENT_MESSAGES)

    if (oldMessages.length === 0) return

    // Summarize old messages
    const newSummary = await summarizeMessages(oldMessages, undefined)

    // TODO: Update session with new summary (needs updateInfo API + schema)
    /* await Session.updateInfo({
      id: config.sessionID,
      historySummary: newSummary,
    }) */

    log.info("session history compressed", {
      sessionID: config.sessionID,
      oldMessageCount: oldMessages.length,
      keptMessageCount: recentMessages.length,
      summaryLength: newSummary.length,
    })
  }

  /**
   * Estimate total tokens for session (summary + messages)
   */
  async function estimateSessionTokens(messages: MessageV2.WithParts[], historySummary?: string): Promise<number> {
    let total = 0

    // Add summary tokens
    if (historySummary) {
      total += Token.estimate(historySummary)
    }

    // Add message tokens
    for (const msg of messages) {
      // Estimate tokens for each message based on parts
      for (const part of msg.parts) {
        if (part.type === "text") {
          total += Token.estimate(part.text)
        } else if (part.type === "tool" && part.state.status === "completed") {
          total += Token.estimate(part.state.output)
        }
      }
    }

    return total
  }

  /**
   * Summarize old messages into a concise text block.
   * Merges with existing summary if present.
   *
   * TODO: Use proper model resolution once enabled
   */
  async function summarizeMessages(messages: MessageV2.WithParts[], existingSummary?: string): Promise<string> {
    // Build text representation of messages
    const messageTexts = messages
      .map((msg) => {
        const role = msg.info.role
        const content = msg.parts
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n")
        return `${role}: ${content}`
      })
      .join("\n\n")

    const prompt = `You are summarizing a conversation history to save context space.

${existingSummary ? `Existing summary:\n${existingSummary}\n\n` : ""}New messages to add:
${messageTexts}

Produce a concise summary that:
1. Preserves key technical decisions, facts, and context
2. Merges with the existing summary if provided
3. Maintains chronological flow
4. Removes redundant or low-value details

Return ONLY the summary text, no other commentary.`

    // TODO: Implement proper LLM summarization once enabled
    // For now, return a simple text concatenation
    log.info("summarization stub called (not yet implemented)")
    return `Previous conversation:\n${messageTexts}`
  }
}
