import type { Memory } from "mem0ai/oss"
import { Log } from "../util/log"
import { Mem0Integration } from "./mem0"
import type { MemoryConfig } from "./config"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import z from "zod"

// Define memory events
export const MemorySearchStarted = BusEvent.define(
  "memory.search.started",
  z.object({
    query: z.string(),
  }),
)

export const MemorySearchCompleted = BusEvent.define(
  "memory.search.completed",
  z.object({
    count: z.number(),
  }),
)

export const MemoryMemorizeStarted = BusEvent.define("memory.memorize.started", z.object({}))

export const MemoryMemorizeCompleted = BusEvent.define(
  "memory.memorize.completed",
  z.object({
    count: z.number(),
  }),
)

export const MemoryError = BusEvent.define(
  "memory.error",
  z.object({
    error: z.string(),
  }),
)

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

      // Emit search started event
      await Bus.publish(MemorySearchStarted, { query: userQuery })

      const memories = await Mem0Integration.search(memory, userQuery, userId, maxResults)

      // Emit search completed event
      await Bus.publish(MemorySearchCompleted, { count: memories.length })

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
      // Emit completed event even on error
      await Bus.publish(MemorySearchCompleted, { count: 0 })
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

      // Emit memorize started event
      await Bus.publish(MemoryMemorizeStarted, {})

      // Let mem0's LLM extract facts from the conversation
      const messages = [
        { role: "user", content: userMessage },
        { role: "assistant", content: assistantMessage },
      ]

      const result = await Mem0Integration.add(memory, messages, userId, { infer: true })

      const count = result.results.length

      // Emit memorize completed event
      await Bus.publish(MemoryMemorizeCompleted, { count })

      if (count > 0) {
        log.info("saved memories", { count })
      } else {
        log.debug("no new memories extracted")
      }
    } catch (error) {
      log.error("failed to save memories", { error })
      // Emit completed event even on error
      await Bus.publish(MemoryMemorizeCompleted, { count: 0 })
    }
  }
}
