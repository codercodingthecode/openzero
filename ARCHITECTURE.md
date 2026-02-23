# OpenZero Architecture

Technical architecture documentation for the OpenZero memory and compression systems.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Interface                            │
│  (TUI / Web App / API)                                          │
└─────────────┬───────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Session Manager                              │
│  - Message routing                                              │
│  - History management                                           │
│  - Hook orchestration                                           │
└──────┬──────────────────────────┬───────────────────────────────┘
       │                          │
       ▼                          ▼
┌──────────────────┐      ┌──────────────────┐
│  Memory System   │      │  Compression     │
│  - Extraction    │      │  - Hierarchical  │
│  - Storage       │      │  - Token mgmt    │
│  - Retrieval     │      │  - State track   │
└──────┬───────────┘      └──────┬───────────┘
       │                          │
       ▼                          ▼
┌──────────────────┐      ┌──────────────────┐
│  Qdrant          │      │  SQLite          │
│  (Vector Store)  │      │  (State/Config)  │
└──────────────────┘      └──────────────────┘
```

---

## Memory System Architecture

### High-Level Flow

```
┌──────────────┐
│ User Message │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────┐
│ beforeUserMessage Hook       │
│ - Retrieve relevant memories │
│ - Inject into context        │
└──────┬───────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│ LLM Processing               │
└──────┬───────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│ Assistant Response           │
└──────┬───────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│ afterAssistantMessage Hook   │
│ - Extract structured facts   │
│ - Store with metadata        │
└──────────────────────────────┘
```

### Detailed Memory Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                    EXTRACTION PHASE                              │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────┐
│ Conversation     │  (User + Assistant messages)
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────────────────┐
│ extraction.ts::extractStructuredFacts()              │
│                                                      │
│  1. Format messages for LLM                         │
│  2. Call LLM with EXTRACTION_PROMPT                 │
│  3. Parse JSON response                             │
│     - Strip code blocks                             │
│     - Normalize Python dicts                        │
│     - Handle nested objects                         │
│  4. Validate against schemas                        │
│  5. Add metadata (userId, hash, timestamp)          │
└────────┬─────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────┐
│ Structured Memories Array                            │
│                                                      │
│ [                                                    │
│   {                                                  │
│     type: "workflow",                               │
│     summary: "...",                                 │
│     command: "...",                                 │
│     trigger: "...",                                 │
│     dependencies: [...]                             │
│   },                                                 │
│   ...                                                │
│ ]                                                    │
└────────┬─────────────────────────────────────────────┘
         │
         ▼

┌─────────────────────────────────────────────────────────────────┐
│                    STORAGE PHASE                                 │
└─────────────────────────────────────────────────────────────────┘

         │
         ▼ (for each memory)
┌──────────────────────────────────────────────────────┐
│ mem0.ts::add()                                       │
│                                                      │
│  Parameters:                                         │
│  - memory: string (summary text)                    │
│  - messages: [] (empty - no inference)              │
│  - userId: string                                   │
│  - options: {                                       │
│      infer: false,                                  │
│      metadata: { type, command, trigger, ... }      │
│    }                                                 │
└────────┬─────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────┐
│ mem0 Library Processing                              │
│                                                      │
│  1. Generate embedding (4096-dim vector)            │
│  2. Search for similar existing memories            │
│  3. Deduplication decision (ADD/UPDATE/DELETE)      │
│  4. Merge metadata into payload                     │
└────────┬─────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────┐
│ qdrant.ts::insert()                                  │
│                                                      │
│  Qdrant Point Structure:                            │
│  {                                                   │
│    id: "uuid",                                      │
│    vector: [0.123, -0.456, ...],                   │
│    payload: {                                       │
│      data: "summary text",                         │
│      userId: "...",                                │
│      hash: "...",                                  │
│      createdAt: "...",                             │
│      type: "workflow",                             │
│      command: "...",                               │
│      trigger: "...",                               │
│      dependencies: [...]                           │
│    }                                                │
│  }                                                  │
└────────┬─────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────┐
│ Qdrant Collection: openzero_memories_4096           │
└──────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    RETRIEVAL PHASE                               │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────┐
│ User Query       │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────────────────┐
│ tools.ts::memory_search()                            │
│                                                      │
│  Parameters:                                         │
│  - query: string                                    │
│  - userId: string                                   │
│  - limit: number (default 5)                        │
└────────┬─────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────┐
│ mem0.ts::search()                                    │
│                                                      │
│  1. Generate query embedding                        │
│  2. Vector similarity search in Qdrant              │
│  3. Filter by userId                                │
│  4. Return top K results with metadata              │
└────────┬─────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────┐
│ Memory Results                                       │
│                                                      │
│ [                                                    │
│   {                                                  │
│     id: "uuid",                                     │
│     memory: "summary text",                         │
│     score: 0.92,                                    │
│     metadata: {                                     │
│       type: "workflow",                             │
│       command: "...",                               │
│       trigger: "...",                               │
│       ...                                            │
│     }                                                │
│   },                                                 │
│   ...                                                │
│ ]                                                    │
└────────┬─────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────┐
│ tools.ts::formatMemory()                             │
│                                                      │
│  Priority 1: Use metadata fields                    │
│  - Check: m.metadata && "type" in m.metadata        │
│  - Format: Type-specific templates                  │
│                                                      │
│  Priority 2: Parse memory field as JSON             │
│  - Try: JSON.parse(m.memory)                        │
│  - Fallback: Use as plain text                      │
└────────┬─────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────┐
│ Formatted Output for LLM                             │
│                                                      │
│ "# Relevant Past Context                            │
│                                                      │
│ 1. [workflow] Check RAM on lab server               │
│    Command: `ssh lab 'free -h'`                     │
│    Trigger: before deployments                      │
│    Requires: SSH key configured                     │
│    Score: 0.92                                      │
│                                                      │
│ 2. [config] SSH key location                        │
│    Setting: Deploy key                              │
│    Location: ~/.ssh/deploy_rsa                      │
│    Score: 0.87"                                     │
└──────────────────────────────────────────────────────┘
```

---

## Compression System Architecture

### State Management

```
┌──────────────────────────────────────────────────────┐
│ Session State (SQLite)                               │
│                                                      │
│ session_state table:                                │
│ ┌────────────┬─────────────┬──────────────┐       │
│ │ session_id │ history     │ last_updated │       │
│ ├────────────┼─────────────┼──────────────┤       │
│ │ "abc123"   │ JSON array  │ 1708620000   │       │
│ └────────────┴─────────────┴──────────────┘       │
└──────────────────────────────────────────────────────┘
```

### Compression Flow

```
┌──────────────────────────────────────────────────────┐
│ Full Session History (500 exchanges)                 │
└────────┬─────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────┐
│ compression.ts::compressHistory()                    │
│                                                      │
│  Algorithm:                                          │
│  1. Identify exchange boundaries                    │
│  2. Segment into tiers:                             │
│     - Tier 1: Last 3 exchanges (keep full)          │
│     - Tier 2: Exchanges 4-10 (medium summary)       │
│     - Tier 3: Exchanges 11+ (high-level summary)    │
│  3. Call LLM for each tier's summary                │
│  4. Rebuild history array                           │
└────────┬─────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────┐
│ Compressed History Structure                         │
│                                                      │
│ {                                                    │
│   tier1: [                                          │
│     { user: "...", assistant: "...", tokens: 450 }, │
│     { user: "...", assistant: "...", tokens: 380 }, │
│     { user: "...", assistant: "...", tokens: 520 }  │
│   ],                                                 │
│   tier2: {                                           │
│     summary: "Medium detail summary...",            │
│     exchangeCount: 7,                               │
│     tokens: 200                                     │
│   },                                                 │
│   tier3: {                                           │
│     summary: "High-level overview...",              │
│     exchangeCount: 490,                             │
│     tokens: 100                                     │
│   }                                                  │
│ }                                                    │
└────────┬─────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────┐
│ state-update.ts::saveState()                         │
│                                                      │
│ UPDATE session_state                                │
│ SET history = JSON.stringify(compressed),           │
│     last_updated = Date.now()                       │
│ WHERE session_id = ?                                │
└──────────────────────────────────────────────────────┘
```

### Token Calculation

```
┌──────────────────────────────────────────────────────┐
│ processor.ts::calculateTokens()                      │
│                                                      │
│  For each message:                                   │
│  1. Extract content                                 │
│  2. Count using model tokenizer                     │
│     - Anthropic: cl100k_base                        │
│     - OpenAI: tiktoken                              │
│     - Default: rough estimate (chars / 4)           │
│  3. Sum user + assistant tokens                     │
│  4. Store in exchange metadata                      │
└──────────────────────────────────────────────────────┘
```

---

## Data Schema

### Memory Schema (TypeScript)

```typescript
// Base memory interface
interface BaseMemory {
  type: MemoryType
  summary: string
  details?: string
  userId: string
  hash: string
  createdAt: string
}

// Workflow memory
interface WorkflowMemory extends BaseMemory {
  type: "workflow"
  command: string
  trigger: string
  dependencies: string[]
}

// Bug fix memory
interface BugFixMemory extends BaseMemory {
  type: "bug_fix"
  symptom: string
  rootCause: string
  solution: string
  preventionTips?: string
}

// Architecture memory
interface ArchitectureMemory extends BaseMemory {
  type: "architecture"
  decision: string
  rationale: string
  alternatives?: string[]
  tradeoffs?: string
}

// Preference memory
interface PreferenceMemory extends BaseMemory {
  type: "preference"
  category: string
  examples: string[]
}

// Config memory
interface ConfigMemory extends BaseMemory {
  type: "config"
  setting: string
  value: string
  location: string
  purpose?: string
}

// Fact memory
interface FactMemory extends BaseMemory {
  type: "fact"
  keywords?: string[]
}
```

### Qdrant Schema

```json
{
  "collection_name": "openzero_memories_4096",
  "vectors": {
    "size": 4096,
    "distance": "Cosine"
  },
  "payload_schema": {
    "data": "text",
    "userId": "keyword",
    "hash": "keyword",
    "createdAt": "text",
    "type": "keyword",
    "summary": "text",
    "details": "text",
    "command": "text",
    "trigger": "text",
    "dependencies": ["text"],
    "symptom": "text",
    "rootCause": "text",
    "solution": "text",
    "preventionTips": "text",
    "decision": "text",
    "rationale": "text",
    "alternatives": ["text"],
    "tradeoffs": "text",
    "category": "keyword",
    "examples": ["text"],
    "setting": "text",
    "value": "text",
    "location": "text",
    "purpose": "text",
    "keywords": ["keyword"]
  },
  "indexes": [
    { "field": "userId", "type": "keyword" },
    { "field": "type", "type": "keyword" },
    { "field": "hash", "type": "keyword" }
  ]
}
```

### SQLite Schema

```sql
-- Session state for compression
CREATE TABLE session_state (
  session_id TEXT PRIMARY KEY,
  history TEXT NOT NULL,  -- JSON compressed history
  last_updated INTEGER NOT NULL
);

-- Provider model registry
CREATE TABLE provider_model (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  embedding_dim INTEGER,
  max_tokens INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX provider_model_provider_idx ON provider_model(provider);
CREATE INDEX provider_model_model_idx ON provider_model(model);

-- Session history (added field)
ALTER TABLE session ADD COLUMN history TEXT;
```

---

## Configuration Structure

### Memory Configuration

```json
{
  "memory": {
    "enabled": true,
    "model": "openrouter/qwen/qwen-2.5-72b-instruct",
    "embedding_model": "openrouter/qwen/qwen3-embedding-8b",
    "limit": 10,
    "threshold": 0.7,
    "qdrant": {
      "url": "http://localhost:6333",
      "collection": "openzero_memories_4096",
      "dimensions": 4096
    },
    "extraction": {
      "maxRetries": 3,
      "timeout": 30000,
      "batchSize": 5
    }
  }
}
```

### Compression Configuration

```json
{
  "compression": {
    "enabled": true,
    "tier1_window": 3,
    "tier2_window": 7,
    "compression_model": "openrouter/qwen/qwen-2.5-72b-instruct",
    "max_context_tokens": 100000,
    "target_compression_ratio": 0.7
  }
}
```

---

## Integration Points

### Hooks System

```typescript
// Hook registration
hooks.register("beforeUserMessage", async (context) => {
  // Retrieve and inject memories
  const memories = await retrieveRelevantMemories(context.message, context.userId)
  context.systemPrompt += formatMemoriesForInjection(memories)
})

hooks.register("afterAssistantMessage", async (context) => {
  // Extract and store memories
  const facts = await extractStructuredFacts(context.messages, context.config)

  for (const fact of facts) {
    await storeMemory(fact, context.userId)
  }
})
```

### Plugin Integration

```typescript
// Memory plugin
export const memoryPlugin: Plugin = {
  name: "memory",
  version: "1.0.0",
  hooks: {
    beforeUserMessage: retrieveMemoriesHook,
    afterAssistantMessage: extractMemoriesHook,
  },
  tools: [
    {
      name: "memory_search",
      description: "Search past memories",
      parameters: { query: "string", limit: "number" },
      handler: searchMemoriesHandler,
    },
  ],
  settings: memorySettingsSchema,
}
```

---

## Performance Characteristics

### Memory Operations

| Operation  | Latency   | Throughput    | Notes             |
| ---------- | --------- | ------------- | ----------------- |
| Extraction | 2-5s      | 0.2-0.5 req/s | LLM-dependent     |
| Embedding  | 100-300ms | 3-10 req/s    | Model-dependent   |
| Storage    | <100ms    | >10 req/s     | Qdrant insert     |
| Search     | <200ms    | >5 req/s      | Vector similarity |
| Formatting | <10ms     | >100 req/s    | Pure computation  |

### Compression Operations

| Operation       | Latency | Throughput     | Notes            |
| --------------- | ------- | -------------- | ---------------- |
| Token counting  | <50ms   | >20 req/s      | Cached tokenizer |
| Tier 1 (keep)   | <1ms    | N/A            | No processing    |
| Tier 2 (medium) | 1-2s    | 0.5-1 req/s    | LLM summary      |
| Tier 3 (high)   | 2-4s    | 0.25-0.5 req/s | LLM summary      |
| State save      | <50ms   | >20 req/s      | SQLite write     |

---

## Scalability Considerations

### Horizontal Scaling

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  App Server  │     │  App Server  │     │  App Server  │
│  Instance 1  │     │  Instance 2  │     │  Instance 3  │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       └────────────────────┼────────────────────┘
                            │
                ┌───────────┴───────────┐
                │                       │
         ┌──────▼──────┐        ┌──────▼──────┐
         │   Qdrant    │        │   SQLite    │
         │   Cluster   │        │  (shared)   │
         └─────────────┘        └─────────────┘
```

### Vertical Scaling

- **Memory**: 4GB+ recommended (vector caching)
- **CPU**: 4+ cores (parallel extraction)
- **Storage**: SSD recommended (Qdrant performance)
- **Network**: Low latency to Qdrant (<10ms ideal)

---

## Security & Privacy

### Data Isolation

```
User A                    User B
   │                         │
   ▼                         ▼
┌─────────────────────────────────────┐
│        Qdrant Collection            │
│                                     │
│  Points with userId filter:         │
│  ┌──────────────┬──────────────┐   │
│  │ userId: "A"  │ userId: "B"  │   │
│  │ memories...  │ memories...  │   │
│  └──────────────┴──────────────┘   │
└─────────────────────────────────────┘
```

### Access Control

- User IDs hashed before storage
- Qdrant queries always filter by userId
- No cross-user memory access
- Metadata scrubbed of PII during extraction

---

## Monitoring & Observability

### Metrics

```typescript
// Memory metrics
metrics.track("memory.extraction.latency", duration)
metrics.track("memory.extraction.count", factsCount)
metrics.track("memory.storage.success", 1)
metrics.track("memory.retrieval.latency", duration)
metrics.track("memory.retrieval.count", resultsCount)

// Compression metrics
metrics.track("compression.triggered", 1)
metrics.track("compression.ratio", ratio)
metrics.track("compression.tokens_saved", tokensSaved)

// Error tracking
metrics.track("memory.extraction.error", 1, { error: err.message })
metrics.track("memory.storage.error", 1, { error: err.message })
```

### Logging

```typescript
// Structured logging
logger.info("memory-extraction", {
  userId,
  messageCount,
  factsExtracted,
  duration,
  model,
})

logger.info("memory-storage", {
  userId,
  memoryType,
  hash,
  deduplication: "ADD" | "UPDATE" | "SKIP",
})

logger.info("compression-complete", {
  sessionId,
  tier1Count,
  tier2Count,
  tier3Count,
  originalTokens,
  compressedTokens,
  ratio,
})
```

---

## Error Handling

### Retry Strategy

```typescript
// Extraction retries
const extractWithRetry = async (messages: Message[], retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await extractStructuredFacts(messages)
    } catch (err) {
      if (i === retries - 1) throw err
      await sleep(1000 * Math.pow(2, i)) // Exponential backoff
    }
  }
}
```

### Fallback Mechanisms

```
┌──────────────────────────────────────┐
│ Extraction Pipeline                  │
├──────────────────────────────────────┤
│ Try 1: Structured extraction         │
│   ↓ (on error)                       │
│ Try 2: Plain text extraction         │
│   ↓ (on error)                       │
│ Try 3: Skip extraction (log error)   │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ Retrieval Pipeline                   │
├──────────────────────────────────────┤
│ Try 1: Vector search with metadata   │
│   ↓ (on error)                       │
│ Try 2: Simple text search            │
│   ↓ (on error)                       │
│ Try 3: Return empty results          │
└──────────────────────────────────────┘
```

---

## Development Workflow

### Local Setup

```bash
# 1. Start dependencies
docker run -p 6333:6333 qdrant/qdrant

# 2. Initialize database
bun run db:migrate

# 3. Seed test data (optional)
bun run db:seed

# 4. Start dev server
bun run dev

# 5. Run tests
bun test
```

### Testing Strategy

```
┌──────────────────────────────────────┐
│ Unit Tests                           │
│ - extraction.test.ts                 │
│ - schema.test.ts                     │
│ - compression.test.ts                │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ Integration Tests                    │
│ - memory-system.test.ts              │
│ - qdrant-integration.test.ts         │
│ - hooks-integration.test.ts          │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ E2E Tests                            │
│ - full-conversation-flow.test.ts     │
│ - multi-session-memory.test.ts       │
└──────────────────────────────────────┘
```

---

## Deployment Architecture

### Production Setup

```
┌─────────────────────────────────────────────────────┐
│                  Load Balancer                      │
└────────┬────────────────────────────────────────────┘
         │
    ┌────┴────┐
    │         │
┌───▼──┐   ┌──▼───┐
│ App  │   │ App  │
│ Pod1 │   │ Pod2 │
└───┬──┘   └──┬───┘
    │         │
    └────┬────┘
         │
    ┌────▼──────────────────────┐
    │                           │
┌───▼──────┐         ┌──────────▼───┐
│ Qdrant   │         │ PostgreSQL   │
│ Cluster  │         │ (SQLite →)   │
└──────────┘         └──────────────┘
```

### Environment Variables

```bash
# Memory system
MEMORY_ENABLED=true
MEMORY_MODEL=openrouter/qwen/qwen-2.5-72b-instruct
MEMORY_EMBEDDING_MODEL=openrouter/qwen/qwen3-embedding-8b
QDRANT_URL=http://qdrant:6333
QDRANT_COLLECTION=openzero_memories_4096

# Compression
COMPRESSION_ENABLED=true
COMPRESSION_TIER1_WINDOW=3
COMPRESSION_TIER2_WINDOW=7

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/openzero
# or for local dev:
DATABASE_URL=file:./openzero.db
```

---

**Last Updated**: 2026-02-22  
**Version**: 1.0.0-alpha  
**Maintained By**: OpenZero Team
