import type { Plugin, Hooks } from "@openzero/plugin"
import { Log } from "../util/log"
import { Config } from "../config/config"
import { QdrantManager } from "./qdrant"
import { Mem0Integration } from "./mem0"
import { MemoryHooks } from "./hooks"
import { MemoryTools } from "./tools"
import { Session } from "../session"

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

    // Initialize Mem0
    const memory = await Mem0Integration.create(memoryConfig, input.directory).catch((err) => {
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
            // Store for later
            conversationTracker.set(hookInput.sessionID, {
              userMessage: userText,
              assistantMessage: "",
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
          if (!conversation || !conversation.userMessage) return

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
    log.error("memory plugin initialization failed", { error })
    // Return empty hooks on error - don't crash OpenCode
    return {}
  }
}
