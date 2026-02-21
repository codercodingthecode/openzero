import { Log } from "../util/log"
import { Session } from "."
import { SessionHistory } from "./history"
import { Provider } from "../provider/provider"
import { Database, eq } from "../storage/db"
import { SessionTable } from "./session.sql"

/**
 * Hierarchical history compression based on Agent Zero's approach.
 * Runs asynchronously after each turn to keep context manageable.
 *
 * Uses three-level compression:
 * - Current: Recent messages (50% of budget)
 * - Topics: Summarized older topics (30% of budget)
 * - Bulks: Heavily compressed ancient history (20% of budget)
 */
export namespace SessionCompression {
  const log = Log.create({ service: "session.compression" })

  /**
   * Check if session needs compression and trigger it asynchronously.
   * Called after each assistant response.
   */
  export async function maybeCompress(input: { sessionID: string; model: Provider.Model }) {
    const contextLimit = input.model.limit.context
    if (contextLimit === 0) return // Model has no limit

    // Cap the compression trigger at 40k tokens so we don't let context grow infinitely
    // for models with massive context windows (like Gemini 3.1's 2M limit)
    // 40k limit * 0.7 budget = 28k max history tokens (keeps things snappy)
    const effectiveLimit = Math.min(contextLimit, 40_000)

    // Run compression in background - don't block the response
    Promise.resolve()
      .then(() => compress({ sessionID: input.sessionID, contextLimit: effectiveLimit }))
      .catch((error) => {
        log.error("background compression failed", { error, sessionID: input.sessionID })
      })
  }

  /**
   * Compress history using hierarchical structure.
   */
  async function compress(config: { sessionID: string; contextLimit: number }) {
    try {
      // 1. Load current messages and build/update history
      const messages = await Session.messages({ sessionID: config.sessionID })
      const sessions = await Session.list()
      const session = sessions.find((s) => s.id === config.sessionID)

      if (!session) {
        log.warn("session not found for compression", { sessionID: config.sessionID })
        return
      }

      // Load existing history or create new
      const history = session.history ? SessionHistory.deserialize(session.history) : SessionHistory.create()

      // Find new messages that haven't been processed yet
      const lastProcessedIndex = history.lastMessageID
        ? messages.findIndex((m) => m.info.id === history.lastMessageID)
        : -1

      const newMessages = lastProcessedIndex >= 0 ? messages.slice(lastProcessedIndex + 1) : messages

      // Only add NEW messages to current topic
      if (newMessages.length > 0) {
        const historyMessages = SessionHistory.fromMessages(newMessages)
        for (const msg of historyMessages) {
          SessionHistory.addMessage(history, msg)
        }
        // Track the last message we processed
        history.lastMessageID = messages[messages.length - 1].info.id
      }

      // 2. Check if compression needed
      if (!SessionHistory.isOverLimit(history, config.contextLimit)) {
        log.debug("history within limits, no compression needed", {
          sessionID: config.sessionID,
          totalTokens: SessionHistory.getTotalTokens(history),
          limit: Math.floor(config.contextLimit * 0.7),
        })
        return
      }

      log.info("compressing session history", {
        sessionID: config.sessionID,
        totalTokens: SessionHistory.getTotalTokens(history),
        contextLimit: config.contextLimit,
      })

      // 3. Compress hierarchically (Agent Zero algorithm)
      const compressed = await SessionHistory.compress(history, config.contextLimit)

      if (compressed) {
        // 4. Save compressed history back to session
        const serialized = SessionHistory.serialize(history)
        Database.use((db) => {
          db.update(SessionTable).set({ history: serialized }).where(eq(SessionTable.id, config.sessionID)).run()
        })

        log.info("session history compressed successfully", {
          sessionID: config.sessionID,
          totalTokens: SessionHistory.getTotalTokens(history),
          currentMessages: history.current.messages.length,
          topics: history.topics.length,
          bulks: history.bulks.length,
        })
      }
    } catch (error) {
      log.error("compression failed", { error, sessionID: config.sessionID })
    }
  }
}
