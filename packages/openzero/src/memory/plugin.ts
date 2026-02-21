import type { Plugin, Hooks } from "@openzero/plugin"
import { Log } from "../util/log"
import { Config } from "../config/config"
import { QdrantManager } from "./qdrant"
import { Mem0Integration } from "./mem0"
import { MemoryHooks, MemoryError } from "./hooks"
import { MemoryTools } from "./tools"
import { Session } from "../session"
import { Auth } from "../auth"
import { Bus } from "../bus"

export const MemoryPlugin: Plugin = async (input) => {
  const log = Log.create({ service: "memory-plugin" })

  try {
    // Get config
    const config = await Config.get()
    const memoryConfig = config.experimental?.memory

    // If memory is not enabled, return empty hooks
    if (!memoryConfig?.enabled) {
      log.debug("memory system disabled")
      return {}
    }

    log.info("initializing memory system")

    // Validate required config
    if (!memoryConfig.model) {
      log.error("memory.model not configured, memory system disabled")
      return {}
    }

    if (!memoryConfig.embedding_model) {
      log.error("memory.embedding_model not configured, memory system disabled")
      return {}
    }

    // Start Qdrant if auto_start is enabled
    const qdrantConfig = {
      host: memoryConfig.qdrant?.host || "localhost",
      port: memoryConfig.qdrant?.port || 6333,
      auto_start: memoryConfig.qdrant?.auto_start ?? true,
    }

    await QdrantManager.start(qdrantConfig).catch((err) => {
      log.error("failed to start qdrant", { error: err })
      throw err
    })

    // Get API key from Auth system based on the provider used
    const embeddingProvider = memoryConfig.embedding_model?.split("/")[0] || "openai"
    const auth = await Auth.all()
    let apiKey: string | undefined

    // Try to find the API key for the embedding provider
    for (const [key, value] of Object.entries(auth)) {
      if (key === embeddingProvider && value.type === "api") {
        apiKey = value.key
        break
      }
    }

    if (!apiKey) {
      log.error(`No API key found for ${embeddingProvider}. Configure it with: openzero auth add ${embeddingProvider}`)
      throw new Error(`No API key found for ${embeddingProvider}. Please run: openzero auth add ${embeddingProvider}`)
    }

    // Initialize Mem0
    const memory = await Mem0Integration.create(memoryConfig, input.directory, apiKey).catch((err) => {
      log.error("failed to initialize mem0", { error: err })
      throw err
    })

    // Get project user ID for scoping memories
    const projectUserId = Mem0Integration.getProjectUserId(input.directory)

    log.info("memory system initialized successfully", { projectUserId })

    // Track conversations for memorization
    const conversationTracker = new Map<string, { userMessage: string; assistantMessage: string }>()

    // Return hooks
    const hooks: Hooks = {
      // Hook: Capture user message
      "chat.message": async (hookInput, output) => {
        try {
          // Extract text from user message
          const userText = output.parts
            .filter((p) => p.type === "text")
            .map((p) => (p as any).text)
            .join(" ")

          if (userText && hookInput.sessionID) {
            log.debug("tracking user message for memory", { sessionID: hookInput.sessionID, chars: userText.length })
            conversationTracker.set(hookInput.sessionID, {
              userMessage: userText,
              assistantMessage: "",
            })
          } else {
            log.warn("skipping user message tracking", {
              sessionID: hookInput.sessionID,
              hasText: !!userText,
              partCount: output.parts.length,
              partTypes: output.parts.map((p) => p.type),
            })
          }
        } catch (error) {
          log.error("failed to capture user message", { error })
        }
      },

      // Hook: Before processing, search and inject relevant memories
      "experimental.chat.system.transform": async (hookInput, output) => {
        if (!hookInput.sessionID) return

        try {
          const conversation = conversationTracker.get(hookInput.sessionID)
          if (!conversation || !conversation.userMessage) return

          // Search and inject memories
          await MemoryHooks.beforeUserMessage(
            memory,
            projectUserId,
            conversation.userMessage,
            output.system,
            memoryConfig,
          )
        } catch (error) {
          log.error("failed to inject memories", { error })
        }
      },

      // Hook: After assistant responds, save the conversation
      "experimental.text.complete": async (hookInput, output) => {
        try {
          const conversation = conversationTracker.get(hookInput.sessionID)
          if (!conversation || !conversation.userMessage) {
            log.warn("text.complete fired but no tracked user message found", {
              sessionID: hookInput.sessionID,
              hasEntry: !!conversation,
              trackerSize: conversationTracker.size,
            })
            return
          }

          // Update assistant message
          conversation.assistantMessage = output.text

          // Save to memory
          await MemoryHooks.afterAssistantMessage(
            memory,
            projectUserId,
            conversation.userMessage,
            conversation.assistantMessage,
          )

          // Clean up
          conversationTracker.delete(hookInput.sessionID)
        } catch (error) {
          log.error("failed to save conversation", { error })
        }
      },

      // Manual memory tools
      tool: {
        memory_save: MemoryTools.createSaveTool(memory, projectUserId),
        memory_search: MemoryTools.createSearchTool(memory, projectUserId),
        memory_delete: MemoryTools.createDeleteTool(memory),
      },
    }

    return hooks
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log.error("memory plugin initialization failed", { error })

    // Emit error event so TUI can show it
    await Bus.publish(MemoryError, { error: errorMessage })

    // Return empty hooks on error - don't crash OpenCode
    return {}
  }
}
