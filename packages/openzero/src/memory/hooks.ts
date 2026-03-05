import type { Memory } from "mem0ai/oss"
import { Log } from "../util/log"
import { Mem0Integration } from "./mem0"
import type { MemoryConfig } from "./config"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import z from "zod"
import { performance } from "node:perf_hooks"
import { MemorySchema } from "./schema"
import { extractStructuredFacts } from "./extraction"
import { Config } from "../config/config"

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

      // Build memory context - format structured memories for AI consumption
      const formattedMemories = memories.map((m, i) => {
        // Try to parse the memory as structured data
        let memoryData: MemorySchema.AnyMemory = m.memory
        try {
          // If memory is a JSON string, parse it
          if (typeof m.memory === "string" && m.memory.trim().startsWith("{")) {
            memoryData = JSON.parse(m.memory)
          }
        } catch {
          // If parsing fails, use as plain string
          memoryData = m.memory
        }

        // Format using the schema formatter
        const formatted = MemorySchema.format(memoryData)
        return `${i + 1}. ${formatted}`
      })

      const memoryContext = [
        "# Relevant Past Context",
        "The following information was learned from previous conversations:",
        "",
        ...formattedMemories,
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
    config: MemoryConfig.Info | undefined,
  ): Promise<void> {
    const start = performance.now()
    try {
      log.debug("memorizing conversation")

      // Emit memorize started event
      await Bus.publish(MemoryMemorizeStarted, {})

      // Format messages for extraction
      const messages = [
        { role: "user", content: userMessage },
        { role: "assistant", content: assistantMessage },
      ]

      // STEP 1: Extract structured facts ourselves using custom LLM call
      const modelString = config?.model || "openai/gpt-4o-mini"
      // Parse model string: "provider/model" -> { provider, model }
      const parts = modelString.split("/")
      const memoryModel =
        parts.length >= 2
          ? { provider: parts[0], model: parts.slice(1).join("/") }
          : { provider: "openai", model: modelString }

      const extractionResult = await extractStructuredFacts(messages, memoryModel)

      if (extractionResult.error) {
        log.error("memory extraction failed", { error: extractionResult.error })
        await Bus.publish(MemoryError, { error: `Memory Extraction Failed: ${extractionResult.error}` })
        await Bus.publish(MemoryMemorizeCompleted, { count: 0 })
        return
      }

      const facts = extractionResult.facts

      if (facts.length === 0) {
        log.debug("no facts extracted from conversation", { durationMs: durationMs(start) })
        await Bus.publish(MemoryMemorizeCompleted, { count: 0 })
        return
      }

      log.debug("extracted structured facts", {
        count: facts.length,
        types: facts.map((f) => f.type),
      })

      // STEP 2: Store each fact with structured metadata (infer: false)
      const results = []
      for (const fact of facts) {
        // Use summary as the searchable text
        const text = fact.summary

        // Put all structured fields in metadata (except summary which is the main text)
        const metadata: Record<string, any> = {
          type: fact.type,
          details: fact.details,
          keywords: fact.keywords,
          context: fact.context,
        }

        // Add type-specific fields
        switch (fact.type) {
          case "workflow":
            if (fact.command) metadata.command = fact.command
            if (fact.trigger) metadata.trigger = fact.trigger
            if (fact.dependencies) metadata.dependencies = fact.dependencies
            break
          case "preference":
            if (fact.category) metadata.category = fact.category
            if (fact.examples) metadata.examples = fact.examples
            break
          case "bug_fix":
            metadata.symptom = fact.symptom
            metadata.solution = fact.solution
            if (fact.rootCause) metadata.rootCause = fact.rootCause
            if (fact.preventionTips) metadata.preventionTips = fact.preventionTips
            break
          case "architecture":
            if (fact.decision) metadata.decision = fact.decision
            if (fact.rationale) metadata.rationale = fact.rationale
            if (fact.alternatives) metadata.alternatives = fact.alternatives
            if (fact.tradeoffs) metadata.tradeoffs = fact.tradeoffs
            break
          case "config":
            metadata.setting = fact.setting
            if (fact.value) metadata.value = fact.value
            if (fact.location) metadata.location = fact.location
            if (fact.purpose) metadata.purpose = fact.purpose
            break
          case "fact":
            // Fact type just uses base fields (summary, details, etc.)
            break
        }

        // Call mem0 with infer: false so it doesn't re-extract
        const result = await Mem0Integration.add(memory, text, userId, {
          infer: false,
          metadata,
        })

        results.push(...result.results)
      }

      const count = results.length

      // Emit memorize completed event
      await Bus.publish(MemoryMemorizeCompleted, { count })

      if (count > 0) {
        log.info("saved structured memories", {
          count,
          types: facts.map((f) => f.type),
          durationMs: durationMs(start),
        })
      } else {
        log.debug("no memories saved after deduplication", { durationMs: durationMs(start) })
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
