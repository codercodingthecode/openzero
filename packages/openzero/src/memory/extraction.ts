import { generateText } from "ai"
import { Provider } from "../provider/provider"
import { MemoryPrompts } from "./prompts"
import { MemorySchema } from "./schema"
import { Log } from "../util/log"

const log = Log.create({ service: "memory-extraction" })

export interface ExtractionResult {
  facts: MemorySchema.StructuredMemory[]
  error?: string
}

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
 * @returns ExtractionResult with facts and optional error message
 */
export async function extractStructuredFacts(
  messages: Array<{ role: string; content: string }>,
  memoryModel: { provider: string; model: string },
): Promise<ExtractionResult> {
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
      const errorMsg = `Failed to parse memory extraction response as JSON. Model may not support JSON output format.`
      log.error(errorMsg, {
        response: cleaned.substring(0, 500),
        error: parseError,
      })
      return { facts: [], error: errorMsg }
    }

    // Validate and collect structured facts
    const facts: MemorySchema.StructuredMemory[] = []
    const rawFacts = parsed.facts || []

    if (!Array.isArray(rawFacts)) {
      const errorMsg = `Memory extraction response 'facts' field is not an array`
      log.warn(errorMsg, { parsed })
      return { facts: [], error: errorMsg }
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

    return { facts }
  } catch (error) {
    const durationMs = Date.now() - start
    const errorMessage = error instanceof Error ? error.message : String(error)

    log.error("failed to extract structured facts", {
      error: errorMessage,
      durationMs,
    })

    return { facts: [], error: errorMessage }
  }
}

/**
 * Strip markdown code blocks and thinking content from text.
 * LLMs sometimes wrap JSON in ```json blocks, and thinking models
 * output reasoning content in <think>...</think> tags before JSON.
 */
function stripCodeBlocks(text: string): string {
  // Remove <think>...</think> blocks (thinking model reasoning content)
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>\s*/g, "")

  // Remove ```json ... ``` blocks
  cleaned = cleaned.replace(/```(?:json)?\s*\n?([\s\S]*?)\n?```/g, "$1")

  // Remove leading/trailing whitespace
  cleaned = cleaned.trim()

  return cleaned
}
