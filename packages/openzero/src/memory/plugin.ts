import type { Plugin, Hooks } from "@openzero/plugin"
import { Log } from "../util/log"
import { Config } from "../config/config"
import { QdrantManager } from "./qdrant"
import { Mem0Integration } from "./mem0"
import { MemoryHooks, MemoryError } from "./hooks"
import { MemoryTools } from "./tools"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
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

    // Get API keys from Auth system for both providers
    const llmProvider = memoryConfig.model?.split("/")[0]
    const embedProvider = memoryConfig.embedding_model?.split("/")[0]
    const auth = await Auth.all()

    const llmEntry = llmProvider
      ? Object.entries(auth).find(([k, v]) => k === llmProvider && v.type === "api")
      : undefined
    const embedEntry = embedProvider
      ? Object.entries(auth).find(([k, v]) => k === embedProvider && v.type === "api")
      : undefined
    const llmApiKey = llmEntry?.[1].type === "api" ? llmEntry[1].key : "dummy"
    const embedApiKey = embedEntry?.[1].type === "api" ? embedEntry[1].key : "dummy"

    // Initialize Mem0
    const memory = await Mem0Integration.create(memoryConfig, input.directory, llmApiKey, embedApiKey).catch((err) => {
      log.error("failed to initialize mem0", { error: err })
      throw err
    })

    // Get project user ID for scoping memories
    const projectUserId = Mem0Integration.getProjectUserId(input.directory)

    log.info("memory system initialized successfully", { projectUserId })

    // Track user messages per session for memorization
    const userMessages = new Map<string, string>()

    // Return hooks
    const hooks: Hooks = {
      // Hook: Capture user message
      "chat.message": async (hookInput, output) => {
        try {
          const userText = output.parts
            .filter((p) => p.type === "text")
            .map((p) => (p as any).text)
            .join(" ")

          if (userText && hookInput.sessionID) {
            log.debug("tracking user message for memory", { sessionID: hookInput.sessionID, chars: userText.length })
            userMessages.set(hookInput.sessionID, userText)
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
          const userMessage = userMessages.get(hookInput.sessionID)
          if (!userMessage) return

          await MemoryHooks.beforeUserMessage(memory, projectUserId, userMessage, output.system, memoryConfig)
        } catch (error) {
          log.error("failed to inject memories", { error })
        }
      },

      // Hook: After assistant fully completes a turn (all steps + tool calls done), save the conversation
      "experimental.assistant.complete": async (hookInput) => {
        try {
          const userMessage = userMessages.get(hookInput.sessionID)
          if (!userMessage) {
            log.warn("assistant.complete fired but no tracked user message found", {
              sessionID: hookInput.sessionID,
            })
            return
          }

          // Read all text parts from the completed assistant message
          const parts = await MessageV2.parts(hookInput.messageID)
          const assistantText = parts
            .filter((p) => p.type === "text")
            .map((p) => (p as MessageV2.TextPart).text)
            .join("\n")

          // Clean up regardless of whether we save
          userMessages.delete(hookInput.sessionID)

          if (!assistantText) {
            log.debug("assistant turn had no text parts, skipping memorization")
            return
          }

          await MemoryHooks.afterAssistantMessage(memory, projectUserId, userMessage, assistantText, memoryConfig)
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
