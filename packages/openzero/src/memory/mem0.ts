import { Memory } from "mem0ai/oss"
import type { MemoryConfig } from "./config"
import { Log } from "../util/log"
import { MemoryPrompts } from "./prompts"
import crypto from "crypto"
import { performance } from "node:perf_hooks"

export namespace Mem0Integration {
  const log = Log.create({ service: "mem0" })

  export interface MemorySearchResult {
    id: string
    memory: string
    score: number
    metadata?: Record<string, any>
  }

  export interface MemoryAddResult {
    results: MemorySearchResult[]
  }

  let memoryInstance: Memory | null = null

  function durationMs(start: number): number {
    return Math.round((performance.now() - start) * 100) / 100
  }

  function wrapTiming<T extends (...args: any[]) => Promise<any>>(
    label: string,
    fn: T,
    extra?: (args: Parameters<T>) => Record<string, any>,
  ): T {
    return (async (...args: Parameters<T>) => {
      const start = performance.now()
      try {
        return await fn(...args)
      } finally {
        log.info("mem0 timing", {
          step: label,
          durationMs: durationMs(start),
          ...(extra ? extra(args) : {}),
        })
      }
    }) as T
  }

  function instrumentMemory(memory: Memory): void {
    let llmCalls = 0
    if (memory.llm?.generateResponse) {
      const original = memory.llm.generateResponse.bind(memory.llm)
      memory.llm.generateResponse = wrapTiming("llm.generateResponse", original, (args) => {
        const messages = args[0]
        const promptChars = Array.isArray(messages)
          ? messages.reduce((sum, msg) => {
              const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
              return sum + content.length
            }, 0)
          : 0
        llmCalls += 1
        return {
          call: llmCalls,
          promptChars,
          responseFormat: args[1]?.type,
        }
      })
    }

    if (memory.embedder?.embed) {
      const original = memory.embedder.embed.bind(memory.embedder)
      memory.embedder.embed = wrapTiming("embedder.embed", original, (args) => ({
        textChars: typeof args[0] === "string" ? args[0].length : JSON.stringify(args[0]).length,
      }))
    }

    if (memory.embedder?.embedBatch) {
      const original = memory.embedder.embedBatch.bind(memory.embedder)
      memory.embedder.embedBatch = wrapTiming("embedder.embedBatch", original, (args) => ({
        count: Array.isArray(args[0]) ? args[0].length : 0,
      }))
    }

    if (memory.vectorStore?.search) {
      const original = memory.vectorStore.search.bind(memory.vectorStore)
      memory.vectorStore.search = wrapTiming("vectorStore.search", original, (args) => ({
        limit: args[1],
      }))
    }

    if (memory.vectorStore?.insert) {
      const original = memory.vectorStore.insert.bind(memory.vectorStore)
      memory.vectorStore.insert = wrapTiming("vectorStore.insert", original, (args) => ({
        count: Array.isArray(args[0]) ? args[0].length : 0,
      }))
    }

    if (memory.vectorStore?.update) {
      const original = memory.vectorStore.update.bind(memory.vectorStore)
      memory.vectorStore.update = wrapTiming("vectorStore.update", original)
    }

    if (memory.vectorStore?.get) {
      const original = memory.vectorStore.get.bind(memory.vectorStore)
      memory.vectorStore.get = wrapTiming("vectorStore.get", original)
    }

    if (memory.vectorStore?.delete) {
      const original = memory.vectorStore.delete.bind(memory.vectorStore)
      memory.vectorStore.delete = wrapTiming("vectorStore.delete", original)
    }

    if (memory.vectorStore?.list) {
      const original = memory.vectorStore.list.bind(memory.vectorStore)
      memory.vectorStore.list = wrapTiming("vectorStore.list", original, (args) => ({
        limit: args[1],
      }))
    }

    if (memory.db?.addHistory) {
      const original = memory.db.addHistory.bind(memory.db)
      memory.db.addHistory = wrapTiming("history.add", original)
    }
  }

  /**
   * Get the embedding dimension for a given embedding model
   */
  function getEmbeddingDimension(model: string): number {
    // Common embedding model dimensions
    const dimensions: Record<string, number> = {
      "text-embedding-3-small": 1536,
      "text-embedding-3-large": 3072,
      "text-embedding-ada-002": 1536,
    }

    // Extract model name (handle both "openai/text-embedding-3-small" and "text-embedding-3-small")
    const modelName = model.includes("/") ? model.split("/")[1] : model

    return dimensions[modelName] || 1536 // Default to 1536
  }

  /**
   * Parse model string into provider and model name
   * e.g., "openai/gpt-4o-mini" -> { provider: "openai", model: "gpt-4o-mini" }
   */
  function parseModelString(modelString: string): { provider: string; model: string } {
    const parts = modelString.split("/")
    if (parts.length === 2) {
      return { provider: parts[0], model: parts[1] }
    }
    // Default to openai if no provider specified
    return { provider: "openai", model: modelString }
  }

  /**
   * Create project-specific user ID from directory path
   */
  export function getProjectUserId(projectPath: string): string {
    const hash = crypto.createHash("sha256").update(projectPath).digest("hex")
    return hash.substring(0, 16) // Use first 16 chars of hash
  }

  /**
   * Initialize Mem0 with OpenCode-specific configuration
   */
  export async function create(
    config: MemoryConfig.Info,
    projectPath: string,
    providerApiKey?: string,
  ): Promise<Memory> {
    if (memoryInstance) {
      log.debug("reusing existing mem0 instance")
      return memoryInstance
    }

    const model = config?.model || ""
    const embModel = config?.embedding_model || ""
    const qdrantHost = config?.qdrant?.host || "localhost"
    const qdrantPort = config?.qdrant?.port || 6333

    const memoryModel = parseModelString(model)
    const embeddingModel = parseModelString(embModel)
    const embeddingDims = getEmbeddingDimension(embModel)

    log.info("initializing mem0", {
      memoryModel: model,
      embeddingModel: embModel,
      embeddingDims,
      qdrantHost,
      qdrantPort,
    })

    // Get API key from environment or provider config
    const apiKey = providerApiKey || process.env.OPENAI_API_KEY

    if (!apiKey) {
      throw new Error(
        "No API key found for memory provider. Please configure your OpenAI API key or the provider specified in memory.model.",
      )
    }

    try {
      memoryInstance = new Memory({
        llm: {
          provider: memoryModel.provider,
          config: {
            model: memoryModel.model,
            apiKey: apiKey,
          },
        },
        embedder: {
          provider: embeddingModel.provider,
          config: {
            model: embeddingModel.model,
            apiKey: apiKey,
          },
        },
        vectorStore: {
          provider: "qdrant",
          config: {
            collectionName: "openzero_memories",
            host: qdrantHost,
            port: qdrantPort,
            embedding_model_dims: embeddingDims,
          },
        },
        disableHistory: true, // Disable sqlite3 history store - we only need Qdrant
        customPrompt: MemoryPrompts.EXTRACTION_PROMPT,
      })

      instrumentMemory(memoryInstance)

      log.info("mem0 initialized successfully")
      return memoryInstance
    } catch (error) {
      log.error("failed to initialize mem0", { error })
      throw error
    }
  }

  /**
   * Search memories for a given query
   */
  export async function search(
    memory: Memory,
    query: string,
    userId: string,
    limit = 5,
  ): Promise<MemorySearchResult[]> {
    try {
      const start = performance.now()
      log.debug("searching memories", { query, userId, limit })
      const result = await memory.search(query, { userId, limit })
      log.debug("memory search complete", {
        resultCount: result.results?.length || 0,
        durationMs: durationMs(start),
      })
      return (result.results || []).map((r) => ({
        id: r.id,
        memory: r.memory,
        score: r.score || 0,
        metadata: r.metadata,
      }))
    } catch (error) {
      log.error("memory search failed", { error, query, userId })
      return []
    }
  }

  /**
   * Add messages to memory (with LLM extraction)
   */
  export async function add(
    memory: Memory,
    messages: string | any[],
    userId: string,
    options: { infer?: boolean } = {},
  ): Promise<MemoryAddResult> {
    try {
      const payloadChars = Array.isArray(messages)
        ? messages.reduce((sum, msg) => {
            if (typeof msg === "string") return sum + msg.length
            try {
              return sum + JSON.stringify(msg).length
            } catch {
              return sum
            }
          }, 0)
        : typeof messages === "string"
          ? messages.length
          : JSON.stringify(messages).length
      const itemCount = Array.isArray(messages) ? messages.length : 1
      const start = performance.now()
      log.debug("adding to memory", {
        userId,
        infer: options.infer !== false,
        itemCount,
        payloadChars,
      })
      const result = await memory.add(messages, {
        userId,
        infer: options.infer,
      })
      const memories = (result.results || []).map((r) => ({
        id: r.id,
        memory: r.memory,
        score: r.score || 0,
        metadata: r.metadata,
      }))
      log.info("memory add complete", {
        count: memories.length,
        durationMs: durationMs(start),
        payloadChars,
      })
      return { results: memories }
    } catch (error) {
      log.error("memory add failed", { error, userId })
      return { results: [] }
    }
  }

  /**
   * Delete a specific memory by ID
   */
  export async function deleteMemory(memory: Memory, memoryId: string): Promise<void> {
    try {
      log.debug("deleting memory", { memoryId })
      await memory.delete(memoryId)
      log.info("memory deleted", { memoryId })
    } catch (error) {
      log.error("memory delete failed", { error, memoryId })
      throw error
    }
  }

  /**
   * Get all memories for a user
   */
  export async function getAll(memory: Memory, userId: string): Promise<MemorySearchResult[]> {
    try {
      log.debug("getting all memories", { userId })
      const result = await memory.getAll({ userId })
      return (result.results || []).map((r) => ({
        id: r.id,
        memory: r.memory,
        score: r.score || 1.0,
        metadata: r.metadata,
      }))
    } catch (error) {
      log.error("get all memories failed", { error, userId })
      return []
    }
  }

  /**
   * Cleanup - stop the memory instance
   */
  export function reset(): void {
    memoryInstance = null
    log.debug("mem0 instance reset")
  }
}
