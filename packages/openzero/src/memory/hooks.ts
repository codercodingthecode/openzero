import type { Memory } from "mem0ai/oss"
import { Log } from "../util/log"
import { Mem0Integration } from "./mem0"
import type { MemoryConfig } from "./config"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import z from "zod"
import { performance } from "node:perf_hooks"

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

  const durationMs = (start: number) => Math.round((performance.now() - start) * 100) / 100

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
    const start = performance.now()
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

      log.info("injecting memories into system prompt", { count: memories.length, durationMs: durationMs(start) })

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
      const errorMessage = error instanceof Error ? error.message : String(error)
      const fullError = JSON.stringify(error)
      log.error("failed to search memories", { error, errorMessage, fullError })

      // Make quota/token errors more visible - check full error object too
      let displayError = `Memory Search Failed: ${errorMessage}`
      const searchText = (errorMessage + fullError).toLowerCase()

      if (searchText.includes("quota") || searchText.includes("insufficient_quota")) {
        displayError = "⚠ QUOTA EXCEEDED (Memory Search)"
      } else if (
        searchText.includes("rate_limit") ||
        searchText.includes("rate limit") ||
        searchText.includes("ratelimit")
      ) {
        displayError = "⚠ RATE LIMIT (Memory Search)"
      } else if (searchText.includes("context") && searchText.includes("length")) {
        displayError = "⚠ CONTEXT TOO LONG (Memory Search)"
      } else if (searchText.includes("401") || searchText.includes("unauthorized")) {
        displayError = "⚠ AUTH ERROR (Memory Search)"
      } else if (searchText.includes("429")) {
        displayError = "⚠ RATE LIMIT 429 (Memory Search)"
      }

      // Emit error event
      log.error("emitting memory error", { displayError })
      await Bus.publish(MemoryError, { error: displayError })
      // Don't emit completed event - let the error state persist
      log.debug("memory search errored", { durationMs: durationMs(start) })
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
    const start = performance.now()
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
        log.info("saved memories", { count, durationMs: durationMs(start) })
      } else {
        log.debug("no new memories extracted", { durationMs: durationMs(start) })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const fullError = JSON.stringify(error)
      log.error("failed to save memories", { error, errorMessage, fullError })

      // Make quota/token errors more visible - check full error object too
      let displayError = `Memory Save Failed: ${errorMessage}`
      const searchText = (errorMessage + fullError).toLowerCase()

      if (searchText.includes("quota") || searchText.includes("insufficient_quota")) {
        displayError = "⚠ QUOTA EXCEEDED (Memory Save)"
      } else if (
        searchText.includes("rate_limit") ||
        searchText.includes("rate limit") ||
        searchText.includes("ratelimit")
      ) {
        displayError = "⚠ RATE LIMIT (Memory Save)"
      } else if (searchText.includes("context") && searchText.includes("length")) {
        displayError = "⚠ CONTEXT TOO LONG (Memory Save)"
      } else if (searchText.includes("401") || searchText.includes("unauthorized")) {
        displayError = "⚠ AUTH ERROR (Memory Save)"
      } else if (searchText.includes("429")) {
        displayError = "⚠ RATE LIMIT 429 (Memory Save)"
      }

      // Emit error event
      log.error("emitting memory error", { displayError })
      await Bus.publish(MemoryError, { error: displayError })
      // Don't emit completed event - let the error state persist
      log.debug("memory save errored", { durationMs: durationMs(start) })
    }
  }
}
