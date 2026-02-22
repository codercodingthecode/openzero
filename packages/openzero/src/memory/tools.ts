import z from "zod"
import { tool } from "@openzero/plugin"
import type { Memory } from "mem0ai/oss"
import { Mem0Integration } from "./mem0"
import { MemorySchema } from "./schema"
import { Log } from "../util/log"

export namespace MemoryTools {
  const log = Log.create({ service: "memory-tools" })

  /**
   * Create memory_save tool
   */
  export function createSaveTool(memory: Memory, projectUserId: string) {
    return tool({
      description: "Save important information to long-term memory for future sessions",
      args: {
        content: z.string().describe("The information to save to memory"),
        scope: z
          .enum(["project", "global"])
          .optional()
          .default("project")
          .describe("Whether to save this memory to the current project or globally"),
      },
      execute: async ({ content, scope }) => {
        try {
          const userId = scope === "global" ? "global" : projectUserId

          log.info("saving memory", { scope, userId })

          // Use infer: false to save content directly without LLM extraction
          // The agent has already decided what to save
          const result = await Mem0Integration.add(memory, content, userId, { infer: false })

          return `Successfully saved to ${scope} memory (${result.results.length} memories created)`
        } catch (error) {
          log.error("memory_save failed", { error })
          return `Error saving memory: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    })
  }

  /**
   * Create memory_search tool
   */
  export function createSearchTool(memory: Memory, projectUserId: string) {
    return tool({
      description: "Search long-term memory for previously saved information",
      args: {
        query: z.string().describe("What to search for in memory"),
        scope: z
          .enum(["project", "global", "both"])
          .optional()
          .default("project")
          .describe("Where to search: project memories, global memories, or both"),
        limit: z.number().optional().default(5).describe("Maximum number of results to return"),
      },
      execute: async ({ query, scope, limit }) => {
        try {
          log.info("searching memory", { query, scope, limit })

          let memories: Mem0Integration.MemorySearchResult[] = []

          if (scope === "project" || scope === "both") {
            const projectMemories = await Mem0Integration.search(memory, query, projectUserId, limit)
            memories.push(...projectMemories)
          }

          if (scope === "global" || scope === "both") {
            const globalMemories = await Mem0Integration.search(memory, query, "global", limit)
            memories.push(...globalMemories)
          }

          // Sort by score and limit
          memories.sort((a, b) => (b.score || 0) - (a.score || 0))
          memories = memories.slice(0, limit)

          if (memories.length === 0) {
            return "No memories found matching your query"
          }

          // Format memories for display (handle both structured metadata and legacy)
          const formattedResults = memories.map((m, idx) => {
            // Priority 1: Use structured metadata if available
            if (m.metadata && typeof m.metadata === "object" && "type" in m.metadata) {
              const structuredMemory: MemorySchema.AnyMemory = {
                type: m.metadata.type,
                summary: m.memory, // The main text
                ...m.metadata, // All other structured fields
              } as any

              const formatted = MemorySchema.format(structuredMemory)
              return `${idx + 1}. [ID: ${m.id}] ${formatted}\n   Score: ${m.score?.toFixed(2) || "N/A"}`
            }

            // Priority 2: Try to parse memory text as structured JSON
            let memoryData: MemorySchema.AnyMemory = m.memory
            try {
              if (typeof m.memory === "string" && m.memory.trim().startsWith("{")) {
                memoryData = JSON.parse(m.memory)
              }
            } catch {
              // Use as plain string if parsing fails
              memoryData = m.memory
            }

            const formatted = MemorySchema.format(memoryData)
            return `${idx + 1}. [ID: ${m.id}] ${formatted}\n   Score: ${m.score?.toFixed(2) || "N/A"}`
          })

          return `Found ${memories.length} memories:\n\n` + formattedResults.join("\n\n")
        } catch (error) {
          log.error("memory_search failed", { error })
          return `Error searching memory: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    })
  }

  /**
   * Create memory_delete tool
   */
  export function createDeleteTool(memory: Memory) {
    return tool({
      description: "Delete a specific memory by ID",
      args: {
        memoryId: z.string().describe("The ID of the memory to delete"),
      },
      execute: async ({ memoryId }) => {
        try {
          log.info("deleting memory", { memoryId })

          await Mem0Integration.deleteMemory(memory, memoryId)

          return `Memory ${memoryId} deleted successfully`
        } catch (error) {
          log.error("memory_delete failed", { error })
          return `Error deleting memory: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    })
  }
}
