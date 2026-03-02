import { Log } from "../util/log"
import { Token } from "../util/token"
import { MessageV2 } from "./message-v2"
import { streamText } from "ai"
import { Provider } from "../provider/provider"
import { Config } from "../config/config"

/**
 * Hierarchical history management inspired by Agent Zero.
 *
 * Three-level structure:
 * - Current: Recent raw messages (50% of context budget)
 * - Topics: Older summarized topics (30% of context budget)
 * - Bulks: Very old, heavily compressed (20% of context budget)
 *
 * Compression is gradual - compresses one level at a time as needed.
 */
export namespace SessionHistory {
  const log = Log.create({ service: "session.history" })

  // Token allocation ratios (from Agent Zero)
  const CURRENT_TOPIC_RATIO = 0.5 // 50% for recent messages
  const HISTORY_TOPIC_RATIO = 0.3 // 30% for older topics
  const HISTORY_BULK_RATIO = 0.2 // 20% for ancient bulks

  // How many topics to keep before moving to bulks
  const TOPICS_KEEP_COUNT = 3

  // How many bulks to merge at once
  const BULK_MERGE_COUNT = 3

  // Compress middle 65% of a topic when it gets too large
  const TOPIC_COMPRESS_RATIO = 0.65

  /**
   * A single message (user or assistant)
   */
  export interface HistoryMessage {
    id: string
    ai: boolean // true = assistant, false = user
    content: string
    tokens: number
    summary?: string // Optional compressed version
  }

  /**
   * A topic: a group of related messages
   */
  export interface HistoryTopic {
    messages: HistoryMessage[]
    summary?: string // Compressed version of all messages
  }

  /**
   * A bulk: merged topics from long ago
   */
  export interface HistoryBulk {
    topics: HistoryTopic[]
    summary?: string // Highly compressed version
  }

  /**
   * Complete hierarchical history for a session
   */
  export interface History {
    current: HistoryTopic // Current conversation topic
    topics: HistoryTopic[] // Older topics (summarized)
    bulks: HistoryBulk[] // Ancient history (heavily compressed)
    lastMessageID?: string // Track last processed message to avoid duplicates
  }

  /**
   * Create empty history
   */
  export function create(): History {
    return {
      current: { messages: [] },
      topics: [],
      bulks: [],
    }
  }

  /**
   * Add a message to current topic
   */
  export function addMessage(history: History, message: HistoryMessage): void {
    history.current.messages.push(message)
  }

  /**
   * Start a new topic (move current to topics)
   */
  export function newTopic(history: History): void {
    if (history.current.messages.length > 0) {
      history.topics.push(history.current)
      history.current = { messages: [] }
    }
  }

  /**
   * Calculate total tokens in history
   */
  export function getTotalTokens(history: History): number {
    return getCurrentTokens(history) + getTopicsTokens(history) + getBulksTokens(history)
  }

  function getCurrentTokens(history: History): number {
    if (history.current.summary) {
      return Token.estimate(history.current.summary)
    }
    return history.current.messages.reduce((sum, msg) => sum + msg.tokens, 0)
  }

  function getTopicsTokens(history: History): number {
    return history.topics.reduce((sum, topic) => {
      if (topic.summary) return sum + Token.estimate(topic.summary)
      return sum + topic.messages.reduce((msgSum, msg) => msgSum + msg.tokens, 0)
    }, 0)
  }

  function getBulksTokens(history: History): number {
    return history.bulks.reduce((sum, bulk) => {
      if (bulk.summary) return sum + Token.estimate(bulk.summary)
      return (
        sum +
        bulk.topics.reduce((topicSum, topic) => {
          if (topic.summary) return topicSum + Token.estimate(topic.summary)
          return topicSum + topic.messages.reduce((msgSum, msg) => msgSum + msg.tokens, 0)
        }, 0)
      )
    }, 0)
  }

  /**
   * Check if history exceeds context limit
   */
  export function isOverLimit(history: History, contextLimit: number, historyRatio: number = 0.7): boolean {
    const allowedTokens = Math.floor(contextLimit * historyRatio)
    return getTotalTokens(history) > allowedTokens
  }

  /**
   * Compress history to fit within token budget.
   * Agent Zero's algorithm: compresses the most "over budget" level first.
   * Runs iteratively until all levels fit their ratios.
   */
  export async function compress(history: History, contextLimit: number): Promise<boolean> {
    let compressed = false
    const historyBudget = Math.floor(contextLimit * 0.7) // Use 70% for history

    while (true) {
      const curr = getCurrentTokens(history)
      const hist = getTopicsTokens(history)
      const bulk = getBulksTokens(history)

      // Calculate how much each level exceeds its ratio
      const ratios: Array<{ tokens: number; ratio: number; level: string }> = [
        { tokens: curr, ratio: CURRENT_TOPIC_RATIO, level: "current" },
        { tokens: hist, ratio: HISTORY_TOPIC_RATIO, level: "topics" },
        { tokens: bulk, ratio: HISTORY_BULK_RATIO, level: "bulks" },
      ]

      // Sort by "most over budget" - (actual / total) / target_ratio
      ratios.sort((a, b) => {
        const overA = a.tokens / historyBudget / a.ratio
        const overB = b.tokens / historyBudget / b.ratio
        return overB - overA
      })

      let compressedPart = false

      // Try to compress the most over-budget level
      for (const { tokens, ratio, level } of ratios) {
        if (tokens > ratio * historyBudget) {
          if (level === "current") {
            compressedPart = await compressCurrent(history)
          } else if (level === "topics") {
            compressedPart = await compressTopics(history)
          } else {
            compressedPart = await compressBulks(history)
          }
          if (compressedPart) break
        }
      }

      if (compressedPart) {
        compressed = true
        continue // Keep compressing
      } else {
        return compressed // Done
      }
    }
  }

  /**
   * Compress current topic:
   * 1. If we have enough messages, split the oldest 65% into a new topic
   *    and push it to the topics array so it can be summarized there.
   * 2. If we only have 1 or 2 massive messages, forcefully summarize the largest one.
   */
  async function compressCurrent(history: History): Promise<boolean> {
    const topic = history.current

    // Don't split if there are barely any messages, instead summarize the largest
    if (topic.messages.length <= 2) {
      if (topic.messages.length === 0) return false

      // Find largest message
      let largestIdx = 0
      for (let i = 1; i < topic.messages.length; i++) {
        if (topic.messages[i].tokens > topic.messages[largestIdx].tokens) {
          largestIdx = i
        }
      }

      const target = topic.messages[largestIdx]
      // Only summarize if it's genuinely huge (e.g. over 5k tokens) to prevent looping on tiny messages
      if (target.tokens > 5000) {
        const summary = await summarizeMessages([target])
        target.content = `[Summary of large output]: ${summary}`
        target.summary = summary
        target.tokens = Token.estimate(target.content)
        return true
      }
      return false
    }

    // We'll split the oldest TOPIC_COMPRESS_RATIO (65%) of messages into a new completed topic
    const countToMove = Math.ceil((topic.messages.length - 1) * TOPIC_COMPRESS_RATIO)

    // We leave the first message (usually the user prompt/start of turn)
    // and move the middle chunk to a new topic
    const msgsToMove = topic.messages.splice(1, countToMove)

    // Push this chunk into topics so compressTopics can summarize it
    history.topics.unshift({ messages: msgsToMove })

    // Keep compressing since we just moved stuff
    return true
  }

  /**
   * Compress topics:
   * 1. Summarize topics that don't have summaries yet
   * 2. Move oldest topic to bulks
   */
  async function compressTopics(history: History): Promise<boolean> {
    // Summarize unsummarized topics
    for (const topic of history.topics) {
      if (!topic.summary) {
        topic.summary = await summarizeTopic(topic)
        return true
      }
    }

    // Move oldest topic to bulks
    if (history.topics.length > 0) {
      const oldest = history.topics.shift()!
      const bulk: HistoryBulk = {
        topics: [oldest],
        summary: oldest.summary,
      }
      history.bulks.push(bulk)
      return true
    }

    return false
  }

  /**
   * Compress bulks:
   * 1. Merge bulks in groups of BULK_MERGE_COUNT
   * 2. Or drop the oldest bulk if can't merge
   */
  async function compressBulks(history: History): Promise<boolean> {
    if (history.bulks.length === 0) return false

    // Try merging bulks
    if (history.bulks.length >= BULK_MERGE_COUNT) {
      const toMerge = history.bulks.splice(0, BULK_MERGE_COUNT)
      const merged = await mergeBulks(toMerge)
      history.bulks.unshift(merged)
      return true
    }

    // Drop oldest bulk as last resort
    history.bulks.shift()
    return true
  }

  /**
   * Summarize a list of messages into a single string
   */
  async function summarizeMessages(messages: HistoryMessage[]): Promise<string> {
    const text = messages.map((msg) => `${msg.ai ? "assistant" : "user"}: ${msg.content}`).join("\n\n")

    const prompt = `Summarize this conversation concisely, preserving key technical decisions and context. Focus on:
- Code changes and technical decisions
- Important facts and preferences
- Solutions to problems
- Keep it under 200 words

Conversation:
${text}

Summary:`

    try {
      const cfg = await Config.get()
      const memoryModel = cfg.experimental?.memory?.model
      if (!memoryModel) {
        throw new Error("Memory Model not configured. Set experimental.memory.model in settings.")
      }
      const [providerId, modelId] = memoryModel.split("/")
      const model = await Provider.getModel(providerId, modelId)
      const language = await Provider.getLanguage(model)

      const result = await streamText({
        model: language,
        prompt,
      })

      let summary = ""
      for await (const chunk of result.textStream) {
        summary += chunk
      }

      return summary.trim()
    } catch (error) {
      log.error("failed to summarize messages", { error })
      throw error
    }
  }

  /**
   * Summarize an entire topic
   */
  async function summarizeTopic(topic: HistoryTopic): Promise<string> {
    return await summarizeMessages(topic.messages)
  }

  /**
   * Merge multiple bulks into one
   */
  async function mergeBulks(bulks: HistoryBulk[]): Promise<HistoryBulk> {
    const allSummaries = bulks.map((b) => b.summary || "[No summary]").join("\n\n---\n\n")

    const prompt = `Merge these conversation summaries into one concise combined summary, preserving the most important information:

${allSummaries}

Combined summary:`

    try {
      const cfg = await Config.get()
      const memoryModel = cfg.experimental?.memory?.model
      if (!memoryModel) {
        throw new Error("Memory Model not configured. Set experimental.memory.model in settings.")
      }
      const [providerId, modelId] = memoryModel.split("/")
      const model = await Provider.getModel(providerId, modelId)
      const language = await Provider.getLanguage(model)

      const result = await streamText({
        model: language,
        prompt,
      })

      let summary = ""
      for await (const chunk of result.textStream) {
        summary += chunk
      }

      return {
        topics: bulks.flatMap((b) => b.topics),
        summary: summary.trim(),
      }
    } catch (error) {
      log.error("failed to merge bulks", { error })
      throw error
    }
  }

  /**
   * Get all message IDs that should still be included in the raw context
   */
  export function getActiveMessageIDs(history: History): Set<string> {
    const ids = new Set<string>()
    for (const msg of history.current.messages) {
      if (msg.id && !msg.id.startsWith("summary-")) ids.add(msg.id)
    }
    for (const topic of history.topics) {
      if (!topic.summary) {
        for (const msg of topic.messages) {
          if (msg.id && !msg.id.startsWith("summary-")) ids.add(msg.id)
        }
      }
    }
    return ids
  }

  /**
   * Convert history summaries to a flat list of messages for prompt injection
   */
  export function getSummaries(history: History): Array<{ role: "user"; content: string }> {
    const result: Array<{ role: "user"; content: string }> = []

    // Add bulk summaries
    for (const bulk of history.bulks) {
      if (bulk.summary) {
        result.push({ role: "user", content: `[Ancient history]: ${bulk.summary}` })
      }
    }

    // Add topic summaries
    for (const topic of history.topics) {
      if (topic.summary) {
        result.push({ role: "user", content: `[Previous topic]: ${topic.summary}` })
      }
    }

    // Add current topic's middle summaries (if any were created by compressCurrent)
    for (const msg of history.current.messages) {
      if (msg.id?.startsWith("summary-") && msg.summary) {
        result.push({ role: "user", content: msg.summary })
      }
    }

    return result
  }

  /**
   * Serialize history to JSON for storage
   */
  export function serialize(history: History): string {
    return JSON.stringify(history)
  }

  /**
   * Deserialize history from JSON
   */
  export function deserialize(json: string): History {
    try {
      return JSON.parse(json)
    } catch {
      return create()
    }
  }

  /**
   * Convert OpenZero messages to history messages
   */
  export function fromMessages(messages: MessageV2.WithParts[]): HistoryMessage[] {
    return messages.map((msg) => {
      let content = ""
      for (const p of msg.parts) {
        if (p.type === "text") content += p.text + "\n"
        else if (p.type === "tool") {
          const args = JSON.stringify(p.state.input || {})
          content += `[Tool Call: ${p.tool} - Args: ${args}]\n`
          if (p.state.status === "completed") {
            content += `[Tool Result: ${p.state.output}]\n`
          } else if (p.state.status === "error") {
            content += `[Tool Error: ${p.state.error}]\n`
          }
        } else if (p.type === "reasoning") {
          content += `[Reasoning: ${p.text}]\n`
        }
      }
      content = content.trim()

      return {
        id: msg.info.id,
        ai: msg.info.role === "assistant",
        content,
        // Use actual output tokens if available for assistant messages to be more accurate
        tokens:
          msg.info.role === "assistant" && msg.info.tokens?.output ? msg.info.tokens.output : Token.estimate(content),
      }
    })
  }
}
