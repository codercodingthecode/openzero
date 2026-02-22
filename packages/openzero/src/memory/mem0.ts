import { Memory } from "mem0ai/oss"
import type { MemoryConfig } from "./config"
import { Log } from "../util/log"
import { MemoryPrompts } from "./prompts"
import { MemorySchema } from "./schema"
import crypto from "crypto"
import { performance } from "node:perf_hooks"
import { generateText, embed, embedMany } from "ai"
import { Provider } from "../provider/provider"

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

  function stripCodeBlocks(input: string): string {
    const match = input.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
    if (!match) return input
    return match[1].trim()
  }

  function instrumentMemory(memory: Memory): void {
    const m = memory as any
    let llmCalls = 0
    if (m.llm?.generateResponse) {
      const original = m.llm.generateResponse.bind(m.llm)
      m.llm.generateResponse = wrapTiming("llm.generateResponse", original, (args) => {
        const messages = args[0]
        const promptChars = Array.isArray(messages)
          ? messages.reduce((sum: number, msg: any) => {
              const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
              return sum + content.length
            }, 0)
          : 0
        llmCalls += 1
        return {
          call: llmCalls,
          promptChars,
          responseFormat: (args[1] as any)?.type,
        }
      })
    }

    if (m.embedder?.embed) {
      const original = m.embedder.embed.bind(m.embedder)
      m.embedder.embed = wrapTiming("embedder.embed", original, (args) => ({
        textChars: typeof args[0] === "string" ? args[0].length : JSON.stringify(args[0]).length,
      }))
    }

    if (m.embedder?.embedBatch) {
      const original = m.embedder.embedBatch.bind(m.embedder)
      m.embedder.embedBatch = wrapTiming("embedder.embedBatch", original, (args) => ({
        count: Array.isArray(args[0]) ? args[0].length : 0,
      }))
    }

    if (m.vectorStore?.search) {
      const original = m.vectorStore.search.bind(m.vectorStore)
      m.vectorStore.search = wrapTiming("vectorStore.search", original, (args) => ({
        limit: args[1],
      }))
    }

    if (m.vectorStore?.insert) {
      const original = m.vectorStore.insert.bind(m.vectorStore)
      m.vectorStore.insert = async (...args: any[]) => {
        const start = performance.now()

        // Transform memory payloads to preserve structured format
        // Mem0 passes an array of memory objects to insert
        if (Array.isArray(args[0])) {
          args[0] = args[0].map((memoryPoint: any) => {
            // memoryPoint has shape: { id, vector, payload: { data, userId, hash, createdAt, ... } }
            if (memoryPoint.payload && typeof memoryPoint.payload.data === "string") {
              const data = memoryPoint.payload.data

              // Try to parse as JSON - if it's structured memory, enhance the payload
              try {
                if (data.trim().startsWith("{")) {
                  const parsed = JSON.parse(data)

                  // Check if it's a structured memory (has type + summary fields)
                  if (MemorySchema.isStructured(parsed)) {
                    log.debug("preserving structured memory format", {
                      type: parsed.type,
                      summary: parsed.summary?.substring(0, 100),
                    })

                    // Store the structured data in payload for rich retrieval
                    return {
                      ...memoryPoint,
                      payload: {
                        ...memoryPoint.payload,
                        // Keep original data for backward compat
                        data,
                        // Add structured fields to payload for filtering/retrieval
                        memory_type: parsed.type,
                        // Spread all structured fields into payload
                        ...parsed,
                      },
                    }
                  }
                }
              } catch (e) {
                // Not JSON, keep as-is (legacy plain-text memory)
              }
            }

            return memoryPoint
          })
        }

        const result = await original(...args)

        log.info("mem0 timing", {
          step: "vectorStore.insert",
          durationMs: durationMs(start),
          count: Array.isArray(args[0]) ? args[0].length : 0,
        })

        return result
      }
    }

    if (m.vectorStore?.update) {
      const original = m.vectorStore.update.bind(m.vectorStore)
      m.vectorStore.update = wrapTiming("vectorStore.update", original)
    }

    if (m.vectorStore?.get) {
      const original = m.vectorStore.get.bind(m.vectorStore)
      m.vectorStore.get = wrapTiming("vectorStore.get", original)
    }

    if (m.vectorStore?.delete) {
      const original = m.vectorStore.delete.bind(m.vectorStore)
      m.vectorStore.delete = wrapTiming("vectorStore.delete", original)
    }

    if (m.vectorStore?.list) {
      const original = m.vectorStore.list.bind(m.vectorStore)
      m.vectorStore.list = wrapTiming("vectorStore.list", original, (args) => ({
        limit: args[1],
      }))
    }

    if (m.db?.addHistory) {
      const original = m.db.addHistory.bind(m.db)
      m.db.addHistory = wrapTiming("history.add", original)
    }
  }

  /**
   * Get the embedding dimension for a given embedding model
   */
  function getEmbeddingDimension(model: string): number {
    const dimensions: Record<string, number> = {
      // OpenAI
      "text-embedding-3-small": 1536,
      "text-embedding-3-large": 3072,
      "text-embedding-ada-002": 1536,
      // Google
      "gemini-embedding-001": 3072,
      "text-embedding-004": 768,
      // Ollama / nomic
      "nomic-embed-text": 768,
      "nomic-embed-text-v1": 768,
      "nomic-embed-text-v1.5": 768,
      // mxbai
      "mxbai-embed-large": 1024,
      "mxbai-embed-large-v1": 1024,
      // all-minilm
      "all-minilm": 384,
      "all-minilm-l6-v2": 384,
      "all-minilm-l12-v2": 384,
      // Cohere
      "embed-english-v3.0": 1024,
      "embed-multilingual-v3.0": 1024,
      "embed-english-light-v3.0": 384,
      "embed-multilingual-light-v3.0": 384,
      "embed-english-v2.0": 4096,
      "embed-english-light-v2.0": 1024,
      // Mistral
      "mistral-embed": 1024,
      // Voyage
      "voyage-large-2": 1536,
      "voyage-2": 1024,
      "voyage-code-2": 1536,
      // Qwen (OpenRouter)
      "qwen3-embedding-4b": 4096,
      "qwen3-embedding-8b": 4096,
    }

    // Extract last segment: "openrouter/qwen/qwen3-embedding-8b" -> "qwen3-embedding-8b"
    const modelName = model.includes("/") ? model.split("/").pop()! : model
    return dimensions[modelName] ?? 1536
  }

  /**
   * Parse model string into provider and model name
   * e.g., "openai/gpt-4o-mini" -> { provider: "openai", model: "gpt-4o-mini" }
   * e.g., "openrouter/qwen/qwen3-embedding-8b" -> { provider: "openrouter", model: "qwen/qwen3-embedding-8b" }
   */
  function parseModelString(modelString: string): { provider: string; model: string } {
    const parts = modelString.split("/")
    if (parts.length >= 2) {
      return { provider: parts[0], model: parts.slice(1).join("/") }
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
    llmApiKey: string,
    embedApiKey: string,
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
    const embeddingDims = config?.embedding_dims ?? getEmbeddingDimension(embModel)
    const collection = `openzero_memories_${embeddingDims}`

    log.info("initializing mem0", {
      memoryModel: model,
      embeddingModel: embModel,
      embeddingDims,
      qdrantHost,
      qdrantPort,
    })

    try {
      // WORKAROUND: mem0ai rejects unsupported providers at init (e.g. "github-copilot", "openrouter")
      // Pass a fake provider name that mem0ai accepts, then proxy intercepts all real calls
      const llmProviderForMem0 = "openai" // mem0ai accepts this
      const embedProviderForMem0 = "openai" // mem0ai accepts this

      memoryInstance = new Memory({
        llm: {
          provider: llmProviderForMem0,
          config: {
            model: memoryModel.model,
            apiKey: llmApiKey,
          },
        },
        embedder: {
          provider: embedProviderForMem0,
          config: {
            model: embeddingModel.model,
            apiKey: embedApiKey,
          },
        },
        vectorStore: {
          provider: "qdrant",
          config: {
            collectionName: collection,
            host: qdrantHost,
            port: qdrantPort,
            dimension: embeddingDims,
          },
        },
        disableHistory: true,
        customPrompt: MemoryPrompts.EXTRACTION_PROMPT,
      })

      // Proxy Mem0 LLM and Embedder back to OpenZero
      const m = memoryInstance as any

      // LLM Proxy
      if (m.llm) {
        m.llm.generateResponse = async (messages: any[], responseFormat?: { type: string }, tools?: any[]) => {
          log.debug("mem0 proxied llm call", { responseFormat, tools: tools?.length })

          const fullModel = await Provider.getModel(memoryModel.provider, memoryModel.model)
          const languageModel = await Provider.getLanguage(fullModel)

          const textMessages = messages.map((msg) => {
            const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
            return { role: msg.role === "assistant" ? "assistant" : msg.role === "system" ? "system" : "user", content }
          }) as any[]

          const result = await generateText({
            model: languageModel,
            messages: textMessages,
            // Only add tool parsing if we didn't explicitly request json, since the two might clash
            // Mem0 handles tool parsing itself if we just return the JSON string
          })

          if (responseFormat?.type === "json_object") {
            const cleaned = stripCodeBlocks(result.text)
            log.debug("mem0 LLM extraction response", {
              rawLength: result.text.length,
              cleanedLength: cleaned.length,
              preview: cleaned.substring(0, 500),
            })
            return cleaned
          }

          if (tools && tools.length > 0) {
            // Mem0 expects either a string or an object with toolCalls
            // Let's try to see if the model gave us a tool call directly
            if (result.toolCalls && result.toolCalls.length > 0) {
              return {
                content: result.text || "",
                role: "assistant",
                toolCalls: result.toolCalls.map((tc: any) => ({
                  name: tc.toolName,
                  arguments: JSON.stringify(tc.args || tc.parameters || tc.arguments || {}),
                })),
              }
            }

            // Fallback: see if the text is JSON that matches a tool
            try {
              const parsed = JSON.parse(result.text)
              // Simple heuristic: if it looks like the tool args, wrap it
              if (Object.keys(parsed).length > 0) {
                return {
                  content: "",
                  role: "assistant",
                  toolCalls: [
                    {
                      name: tools[0].function.name, // Usually mem0 only passes one tool at a time
                      arguments: result.text,
                    },
                  ],
                }
              }
            } catch (e) {
              // Not JSON, just return text
            }
          }

          return result.text
        }
      }

      // Embedder Proxy
      if (m.embedder) {
        m.embedder.embed = async (text: string) => {
          log.debug("mem0 proxied embed call")
          const fullModel = await Provider.getModel(embeddingModel.provider, embeddingModel.model)
          const embeddingModelV2 = await Provider.getEmbedding(fullModel)
          const result = await embed({ model: embeddingModelV2, value: text })
          return result.embedding
        }

        m.embedder.embedBatch = async (texts: string[]) => {
          log.debug("mem0 proxied embedBatch call", { count: texts.length })
          const fullModel = await Provider.getModel(embeddingModel.provider, embeddingModel.model)
          const embeddingModelV2 = await Provider.getEmbedding(fullModel)
          const result = await embedMany({ model: embeddingModelV2, values: texts })
          return result.embeddings
        }
      }

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
   * Add messages to memory (with or without LLM extraction)
   *
   * When infer=true (default), mem0 handles extraction with its internal pipeline.
   * When infer=false, we assume the caller has already extracted structured data
   * and is passing it directly with metadata.
   *
   * For custom extraction with structured metadata, use:
   *   add(memory, summaryText, userId, { infer: false, metadata: {...structured fields} })
   */
  export async function add(
    memory: Memory,
    messages: string | any[],
    userId: string,
    options: { infer?: boolean; metadata?: Record<string, any> } = {},
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
        hasMetadata: !!options.metadata,
      })
      const result = await memory.add(messages, {
        userId,
        infer: options.infer,
        metadata: options.metadata,
      })
      const memories = (result.results || []).map((r) => ({
        id: r.id,
        memory: r.memory,
        score: r.score || 0,
        metadata: r.metadata,
      }))

      // Log structured vs legacy memory format breakdown
      const structuredCount = memories.filter((m) => {
        try {
          if (typeof m.memory === "string" && m.memory.trim().startsWith("{")) {
            const parsed = JSON.parse(m.memory)
            return MemorySchema.isStructured(parsed)
          }
        } catch {}
        return false
      }).length

      log.info("memory add complete", {
        count: memories.length,
        structured: structuredCount,
        legacy: memories.length - structuredCount,
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
