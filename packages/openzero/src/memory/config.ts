import z from "zod"

export namespace MemoryConfig {
  export const Info = z
    .object({
      enabled: z.boolean().optional().default(false),

      // LLM for memory operations (extraction, consolidation)
      model: z.string().optional().describe("LLM model for memory operations (e.g., 'openai/gpt-4o-mini')"),

      // Embedding model for vector search
      embedding_model: z
        .string()
        .optional()
        .describe("Embedding model for vector search (e.g., 'openai/text-embedding-3-small')"),

      // Override vector dimension (required for models not in the built-in dimension map)
      embedding_dims: z.number().optional().describe("Vector dimension for the embedding model"),

      // Qdrant config
      qdrant: z
        .object({
          host: z.string().optional().default("localhost"),
          port: z.number().optional().default(6333),
          auto_start: z.boolean().optional().default(true).describe("Auto-download and start Qdrant server"),
        })
        .optional(),

      // Search config
      max_results: z.number().optional().default(5).describe("Maximum number of memories to retrieve per search"),

      // Recall config (UI-only, backend always recalls)
      recall: z
        .object({
          enabled: z.boolean().optional(),
          interval: z.number().optional(),
          max_results: z.number().optional(),
        })
        .optional(),

      // Auto-memorize config (UI-only, backend always memorizes)
      auto_memorize: z
        .object({
          enabled: z.boolean().optional(),
          idle_timeout: z.number().optional(),
        })
        .optional(),
    })
    .optional()

  export type Info = z.infer<typeof Info>
}
