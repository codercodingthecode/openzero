import { generateText } from "ai"
import { Provider } from "../provider/provider"
import { MemoryPrompts } from "./prompts"
import { MemorySchema } from "./schema"
import { Log } from "../util/log"

const log = Log.create({ service: "memory-extraction" })

/**
 * Extract structured facts from conversation messages using LLM.
 *
 * This function:
 * 1. Formats messages into conversation text
 * 2. Calls LLM with EXTRACTION_PROMPT to extract structured facts
 * 3. Parses and validates the JSON response
 * 4. Returns typed structured memory objects
 *
 * @param messages - Array of conversation messages with role and content
 * @param memoryModel - Model configuration {provider, model}
 * @returns Array of validated structured memory objects
 */
export async function extractStructuredFacts(
  messages: Array<{ role: string; content: string }>,
  memoryModel: { provider: string; model: string },
): Promise<MemorySchema.StructuredMemory[]> {
  const start = Date.now()

  try {
    // Format messages for extraction prompt
    const conversationText = messages.map((m) => `${m.role}: ${m.content}`).join("\n")

    log.debug("extracting facts from conversation", {
      messageCount: messages.length,
      conversationLength: conversationText.length,
    })

    // Get language model from provider
    const fullModel = await Provider.getModel(memoryModel.provider, memoryModel.model)
    const languageModel = await Provider.getLanguage(fullModel)

    // Call LLM with structured extraction prompt
    // The EXTRACTION_PROMPT already instructs the model to return JSON
    // We rely on prompt engineering rather than API-level schema enforcement
    const result = await generateText({
      model: languageModel,
      messages: [
        {
          role: "system",
          content: MemoryPrompts.EXTRACTION_PROMPT.replace("{current_date}", new Date().toISOString().split("T")[0]),
        },
        {
          role: "user",
          content: `Extract facts from this conversation:\n\n${conversationText}`,
        },
      ],
    })

    // Parse LLM response
    const cleaned = stripCodeBlocks(result.text)
    let parsed: any

    try {
      parsed = JSON.parse(cleaned)
    } catch (parseError) {
      log.error("failed to parse LLM extraction response as JSON", {
        response: cleaned.substring(0, 500),
        error: parseError,
      })
      return []
    }

    // Validate and collect structured facts
    const facts: MemorySchema.StructuredMemory[] = []
    const rawFacts = parsed.facts || []

    if (!Array.isArray(rawFacts)) {
      log.warn("LLM response 'facts' field is not an array", { parsed })
      return []
    }

    for (const fact of rawFacts) {
      if (MemorySchema.isStructured(fact)) {
        facts.push(fact)
      } else {
        log.warn("LLM returned non-structured fact, skipping", {
          fact: JSON.stringify(fact).substring(0, 200),
        })
      }
    }

    const durationMs = Date.now() - start

    log.info("extracted structured facts", {
      count: facts.length,
      types: facts.map((f) => f.type),
      durationMs,
    })

    return facts
  } catch (error) {
    const durationMs = Date.now() - start
    const errorMessage = error instanceof Error ? error.message : String(error)

    log.error("failed to extract structured facts", {
      error: errorMessage,
      durationMs,
    })

    // Return empty array on failure - caller can decide fallback strategy
    return []
  }
}

/**
 * Strip markdown code blocks from text (LLMs sometimes wrap JSON in ```json)
 */
function stripCodeBlocks(text: string): string {
  // Remove ```json ... ``` blocks
  let cleaned = text.replace(/```(?:json)?\s*\n?([\s\S]*?)\n?```/g, "$1")

  // Remove leading/trailing whitespace
  cleaned = cleaned.trim()

  return cleaned
}
