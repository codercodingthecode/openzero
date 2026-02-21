import type { Memory } from "mem0ai/oss"
import { Log } from "../util/log"
import { Mem0Integration } from "./mem0"
import type { MemoryConfig } from "./config"

export namespace MemoryHooks {
  const log = Log.create({ service: "memory-hooks" })

  /**
   * Called before each user message is processed.
   * Searches for relevant memories and injects them into the system prompt.
   */
  export async function beforeUserMessage(
    memory: Memory,
    userId: string,
    userQuery: string,
    systemPrompt: string[],
    config: MemoryConfig.Info | undefined,
  ): Promise<void> {
    try {
      const maxResults = config?.max_results || 5
      const memories = await Mem0Integration.search(memory, userQuery, userId, maxResults)

      if (memories.length === 0) {
        log.debug("no relevant memories found")
        return
      }

      log.info("injecting memories into system prompt", { count: memories.length })

      // Build memory context
      const memoryContext = [
        "# Relevant Past Context",
        "The following information was learned from previous conversations:",
        "",
        ...memories.map((m, i) => `${i + 1}. ${m.memory}`),
        "",
      ].join("\n")

      // Inject at the end of system prompt
      systemPrompt.push(memoryContext)
    } catch (error) {
      log.error("failed to search memories", { error })
    }
  }

  /**
   * Called after the assistant finishes responding.
   * Extracts and saves important facts from the conversation.
   */
  export async function afterAssistantMessage(
    memory: Memory,
    userId: string,
    userMessage: string,
    assistantMessage: string,
  ): Promise<void> {
    try {
      log.debug("memorizing conversation")

      // Let mem0's LLM extract facts from the conversation
      const messages = [
        { role: "user", content: userMessage },
        { role: "assistant", content: assistantMessage },
      ]

      const result = await Mem0Integration.add(memory, messages, userId, { infer: true })

      if (result.results.length > 0) {
        log.info("saved memories", { count: result.results.length })
      } else {
        log.debug("no new memories extracted")
      }
    } catch (error) {
      log.error("failed to save memories", { error })
    }
  }
}
