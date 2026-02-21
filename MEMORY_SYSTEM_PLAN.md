# OpenZero Memory System — Implementation Plan

## Overview

Add production-grade long-term memory to OpenCode using **Mem0 OSS** (`mem0ai/oss`) as the memory engine and **Qdrant** as the vector store. The memory system uses a **separate cheap/fast LLM** (e.g., GPT-5-mini) for all memory operations, independent of the main chat model.

This is a fresh OpenCode clone. No Agent Zero code or dependencies.

---

## Architecture

```
                    +-----------------+
  User prompt  ---> |   OpenCode      |  (main chat: Claude Sonnet 4.5, etc.)
                    |   Session Loop  |
                    +--------+--------+
                             |
              +--------------+--------------+
              |                             |
     [before each turn]            [on session idle]
              |                             |
     +--------v--------+          +--------v--------+
     |   RECALL         |          |   MEMORIZE       |
     |   (search mem0)  |          |   (add to mem0)  |
     +--------+---------+          +--------+---------+
              |                             |
              +----------+   +--------------+
                         |   |
                    +----v---v----+
                    |   Mem0 OSS   |  (memory LLM: GPT-5-mini, etc.)
                    |   Library    |
                    +------+------+
                           |
                    +------v------+
                    |   Qdrant     |  (background server, localhost:6333)
                    +-------------+
```

**Two LLMs, two jobs:**

- **Main chat model** (user-configured): Handles coding tasks, tool calls, conversation
- **Memory model** (cheap/fast): Handles fact extraction, consolidation (ADD/UPDATE/DELETE/NONE), recall query generation

---

## Components to Build

### 1. Qdrant Lifecycle Manager

**File:** `packages/opencode/src/memory/qdrant.ts`

Manages the Qdrant server as a background process.

**Responsibilities:**

- Download Qdrant binary on first run (platform-specific: darwin-arm64, darwin-x64, linux-x64, linux-arm64)
- Store binary in `~/.opencode/bin/qdrant`
- Store data in `~/.opencode/memory/qdrant-data/`
- Start Qdrant on OpenCode startup (`spawn` with `--config-path`)
- Health check on `http://localhost:6333/healthz`
- Graceful shutdown on OpenCode exit (SIGTERM)
- Auto-restart if Qdrant crashes
- Port conflict detection (if another instance is already running, reuse it)

**Config (qdrant.yaml):**

```yaml
storage:
  storage_path: ~/.opencode/memory/qdrant-data
service:
  grpc_port: 6334
  http_port: 6333
log_level: WARN
```

**Key decisions:**

- Single Qdrant instance shared across all OpenCode sessions/projects
- Collection name: `openzero_memories`
- Embedding dimension: depends on chosen embedding model (1536 for OpenAI `text-embedding-3-small`)

### 2. Mem0 Integration Layer

**File:** `packages/opencode/src/memory/mem0.ts`

Wraps `mem0ai/oss` `Memory` class with OpenCode-specific configuration.

**Responsibilities:**

- Initialize Mem0 with the memory LLM provider and Qdrant vector store
- Configure the embedding model
- Provide a custom fact-extraction prompt tuned for coding (see Section: Prompts)
- Expose simplified API: `recall(query, projectId)`, `memorize(messages, projectId)`, `forget(id)`, `list(projectId)`

**Configuration mapping:**

```typescript
import { Memory } from "mem0ai/oss"

const memory = new Memory({
  llm: {
    provider: "openai", // from OpenCode config
    config: {
      model: "gpt-5-mini", // from config.memory.model
      apiKey: "...", // from provider config
    },
  },
  embedder: {
    provider: "openai",
    config: {
      model: "text-embedding-3-small", // from config.memory.embedding_model
      apiKey: "...",
    },
  },
  vectorStore: {
    provider: "qdrant",
    config: {
      collectionName: "openzero_memories",
      host: "localhost",
      port: 6333,
      embeddingModelDims: 1536,
    },
  },
  // Custom prompt for coding-focused fact extraction (see Prompts section)
  customPrompt: CODING_MEMORY_EXTRACTION_PROMPT,
})
```

**Scoping model:**

- `userId` = project directory path hash (per-project memories)
- `agentId` = `"global"` for cross-project memories, or the agent name
- `runId` = session ID (optional, for per-session tracking)

### 3. Memory Recall (System Prompt Injection)

**File:** `packages/opencode/src/memory/recall.ts`

Injects relevant memories into the system prompt before each LLM turn.

**Integration point:** `experimental.chat.system.transform` plugin hook

**Algorithm:**

1. On each turn, get the current user message + recent conversation context
2. Call `memory.search(query, { userId: projectHash })` via Mem0
3. Format results as a memory context block
4. Append to the `system[]` array via the plugin hook

**Format injected into system prompt:**

```
<memories>
The following are relevant memories from previous sessions with this user/project.
Use them to maintain continuity and avoid re-discovering known information.

- User prefers functional style over OOP in this codebase
- The project uses Drizzle ORM with SQLite, not Prisma
- Authentication is handled via @openauthjs/openauth
- Previous bug: race condition in session cleanup was fixed by adding mutex in processor.ts
</memories>
```

**Throttling:**

- Do NOT recall on every single turn (expensive + noisy)
- Recall on the FIRST turn of a session (always)
- Recall every Nth turn after that (configurable, default: 3)
- Skip recall if the turn is a tool result (no new user context)

### 4. Memory Auto-Save (Post-Session Memorization)

**File:** `packages/opencode/src/memory/memorize.ts`

Extracts facts and solutions from completed conversations and stores them.

**Integration point:** `Bus.subscribe(SessionStatus.Event.Idle, ...)` — fires when a session loop completes

**Algorithm:**

1. On session idle, retrieve the conversation history for that session
2. Call `memory.add(messages, { userId: projectHash })` via Mem0
3. Mem0 internally: extracts facts via LLM, searches for similar existing memories, decides ADD/UPDATE/DELETE/NONE, executes
4. Log what was memorized (for transparency)

**Debouncing:**

- Sessions go idle after EVERY turn (user sends message, assistant responds, session becomes idle)
- Do NOT memorize after every single turn
- Memorize only when a session has been idle for >60 seconds (configurable) OR when the session is explicitly closed/archived
- Track which messages have already been processed (avoid re-extracting from the same messages)

### 5. Memory Tools (Manual Save/Search/Delete)

**File:** `packages/opencode/src/memory/tools.ts`

Register tools that the main chat LLM can call explicitly.

**Tools to register:**

#### `memory_save`

- **Description:** "Save important information to long-term memory for future sessions"
- **Parameters:** `{ content: string, scope?: "project" | "global" }`
- **Implementation:** `memory.add(content, { userId: scope === "global" ? "global" : projectHash, infer: false })`
- The `infer: false` flag stores the content directly without LLM extraction (the agent already decided what to save)

#### `memory_search`

- **Description:** "Search long-term memory for previously saved information"
- **Parameters:** `{ query: string, scope?: "project" | "global", limit?: number }`
- **Implementation:** `memory.search(query, { userId: projectHash, limit })`

#### `memory_delete`

- **Description:** "Delete a specific memory by ID"
- **Parameters:** `{ memoryId: string }`
- **Implementation:** `memory.delete(memoryId)`

### 6. Configuration Schema Extension

**File:** Modify `packages/opencode/src/config/config.ts`

Add memory configuration under the `experimental` section:

```typescript
experimental: z.object({
  // ... existing fields ...
  memory: z.object({
    enabled: z.boolean().optional().default(false),

    // LLM for memory operations (extraction, consolidation)
    model: z.string().optional(),  // e.g., "openai/gpt-5-mini"

    // Embedding model
    embedding_model: z.string().optional(),  // e.g., "openai/text-embedding-3-small"

    // Qdrant config
    qdrant: z.object({
      host: z.string().optional().default("localhost"),
      port: z.number().optional().default(6333),
      auto_start: z.boolean().optional().default(true),  // auto-download and start Qdrant
    }).optional(),

    // Recall config
    recall: z.object({
      enabled: z.boolean().optional().default(true),
      interval: z.number().optional().default(3),  // recall every Nth turn
      max_results: z.number().optional().default(5),
    }).optional(),

    // Auto-memorize config
    auto_memorize: z.object({
      enabled: z.boolean().optional().default(true),
      idle_timeout: z.number().optional().default(60),  // seconds before memorizing
    }).optional(),
  }).optional(),
}).optional(),
```

**Example user config (`opencode.jsonc`):**

```jsonc
{
  "experimental": {
    "memory": {
      "enabled": true,
      "model": "openai/gpt-5-mini",
      "embedding_model": "openai/text-embedding-3-small",
    },
  },
}
```

### 7. Memory Plugin (Wiring Everything Together)

**File:** `packages/opencode/src/memory/plugin.ts`

A built-in plugin that wires all memory components into OpenCode's lifecycle.

```typescript
// Pseudo-structure
export async function MemoryPlugin(input: PluginInput): Promise<Hooks> {
  const config = await getMemoryConfig()
  if (!config?.enabled) return {}

  // Initialize Qdrant (start server if auto_start)
  await QdrantManager.start(config.qdrant)

  // Initialize Mem0
  const mem0 = await Mem0Integration.create(config)

  // Subscribe to session idle for auto-memorize
  Bus.subscribe(SessionStatus.Event.Idle, async (event) => {
    await Memorize.onSessionIdle(mem0, event.properties.sessionID, config)
  })

  return {
    // Inject recalled memories into system prompt
    "experimental.chat.system.transform": async (input, output) => {
      await Recall.inject(mem0, input, output, config)
    },

    // Register memory tools
    tool: {
      memory_save: memorySaveTool(mem0),
      memory_search: memorySearchTool(mem0),
      memory_delete: memoryDeleteTool(mem0),
    },
  }
}
```

### 8. Entry Point / Initialization

**File:** Modify `packages/opencode/src/plugin/index.ts`

Add `MemoryPlugin` to the internal plugins list (alongside CodexAuthPlugin, CopilotAuthPlugin, etc.):

```typescript
import { MemoryPlugin } from "@/memory/plugin"

// In the plugin loading section:
const internalPlugins = [CodexAuthPlugin, CopilotAuthPlugin, GitlabAuthPlugin, MemoryPlugin]
```

---

## Prompts

### Coding-Focused Fact Extraction Prompt

This replaces Mem0's default "Personal Information Organizer" prompt. It must be tuned for software engineering:

```
You are a Software Engineering Knowledge Extractor. Your role is to identify and extract
important technical facts, decisions, patterns, and preferences from coding conversations
that would be valuable to remember in future sessions.

Extract ONLY information that would be useful across multiple coding sessions. Focus on:

1. **Technical Decisions**: Architecture choices, technology selections, why certain
   approaches were chosen or rejected
2. **Project Patterns**: Coding conventions, file organization, naming patterns,
   preferred libraries and tools
3. **User Preferences**: Coding style, preferred frameworks, testing approaches,
   formatting preferences, workflow habits
4. **Solved Problems**: Bug fixes, workarounds, solutions to tricky issues that
   might recur (include the problem AND solution)
5. **Codebase Facts**: Important file locations, service relationships, API contracts,
   database schemas, deployment configurations
6. **Environment & Tooling**: Build system quirks, CI/CD setup, local dev environment
   specifics, required environment variables

Do NOT extract:
- Transient information (one-time commands, temporary file changes)
- Obvious/generic programming knowledge
- Information already in code comments or documentation
- Greetings, acknowledgments, or social conversation
- Specific code snippets (extract the CONCEPT, not the code)

Return facts as concise, standalone statements that make sense without conversation context.
Each fact should be self-contained and useful on its own.

Today's date is {current_date}.

Return a JSON object with a "facts" key containing an array of fact strings.
If nothing worth remembering was discussed, return {"facts": []}.
```

> NOTE: This prompt is passed via Mem0's `customPrompt` config option. The consolidation prompt (ADD/UPDATE/DELETE/NONE) is handled by Mem0 internally and is already good enough — it's generic and works for any domain.

---

## Dependencies to Add

**In `packages/opencode/package.json`:**

```json
{
  "dependencies": {
    "mem0ai": "^2.2.3",
    "@qdrant/js-client-rest": "^1.13.0"
  }
}
```

**Peer deps to install for mem0ai (based on our chosen providers):**

```json
{
  "dependencies": {
    "openai": "^4.93.0"
  }
}
```

> Note: `openai` may already be pulled in transitively via `@ai-sdk/openai`. Check before adding.

---

## File Structure

```
packages/opencode/src/memory/
  index.ts          — Public exports, Memory namespace
  plugin.ts         — MemoryPlugin (wires everything into OpenCode)
  mem0.ts           — Mem0 OSS wrapper (init, config mapping, simplified API)
  qdrant.ts         — Qdrant binary download, process lifecycle
  recall.ts         — System prompt injection logic
  memorize.ts       — Auto-save logic (session idle handler, debouncing)
  tools.ts          — memory_save, memory_search, memory_delete tool definitions
  prompts.ts        — Coding-focused extraction prompt + any other prompts
  config.ts         — Memory config schema (Zod), defaults, validation
```

---

## Implementation Order

### Phase 1: Foundation (Day 1-2)

1. `config.ts` — Define the memory config schema, add to OpenCode's config
2. `qdrant.ts` — Qdrant binary download + process management
3. `mem0.ts` — Mem0 initialization with Qdrant + coding prompt
4. `plugin.ts` — Basic plugin shell, initialize on startup

**Milestone:** `memory.add("test fact", { userId: "test" })` works, stored in Qdrant

### Phase 2: Recall (Day 2-3)

5. `recall.ts` — System prompt injection via plugin hook
6. Wire into `plugin.ts` — `experimental.chat.system.transform`

**Milestone:** Memories from previous sessions appear in the system prompt

### Phase 3: Auto-Memorize (Day 3-4)

7. `memorize.ts` — Session idle handler, debouncing, message tracking
8. Wire into `plugin.ts` — `Bus.subscribe(SessionStatus.Event.Idle, ...)`

**Milestone:** Facts are automatically extracted and stored after conversations

### Phase 4: Tools (Day 4)

9. `tools.ts` — Register memory_save, memory_search, memory_delete
10. Wire into `plugin.ts` — `Hooks.tool`

**Milestone:** User can explicitly tell the agent to remember/search/forget

### Phase 5: Polish (Day 5)

11. Error handling — graceful degradation if Qdrant is down, if memory model fails, etc.
12. Logging — transparent logging of what was recalled/memorized
13. Testing — unit tests for each component
14. Documentation — config examples, usage guide

---

## Key Technical Decisions

| Decision              | Choice                          | Rationale                                                                                           |
| --------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------- |
| Memory engine         | Mem0 OSS (`mem0ai/oss`)         | Full consolidation logic included, 4 deps, 1.2MB, Apache 2.0, proven at scale                       |
| Vector store          | Qdrant (local server)           | Single binary, handles millions of vectors, best filtering, 30MB idle RAM                           |
| Memory LLM            | Separate from main chat         | Cheap model (GPT-5-mini) for extraction/consolidation, doesn't waste expensive model tokens         |
| Embedding model       | OpenAI `text-embedding-3-small` | 1536 dims, cheap, fast, good quality. Configurable.                                                 |
| Scoping               | `userId` = project path hash    | Per-project isolation by default. `"global"` for cross-project.                                     |
| Integration           | Built-in plugin (not external)  | Needs access to Bus events, session data, provider config — too tightly coupled for external plugin |
| Recall frequency      | Every 3rd turn + first turn     | Balance between relevance and cost/latency                                                          |
| Auto-memorize trigger | Session idle for 60s            | Avoid memorizing mid-conversation, wait for natural pauses                                          |
| Prompts               | Written from scratch for coding | Mem0's defaults are for chatbot personal info, not software engineering                             |

---

## Mem0 API Reference (What We Use)

```typescript
import { Memory } from "mem0ai/oss"

// Initialize
const memory = new Memory({ llm, embedder, vectorStore, customPrompt })

// Store (with LLM extraction + consolidation)
await memory.add(messages, { userId, agentId?, runId? })

// Store (raw, no extraction)
await memory.add(text, { userId, infer: false })

// Search
await memory.search(query, { userId, limit? })

// Get all for a scope
await memory.getAll({ userId })

// Get single
await memory.get(memoryId)

// Update
await memory.update(memoryId, newText)

// Delete
await memory.delete(memoryId)

// Delete all for scope
await memory.deleteAll({ userId })

// History
await memory.history(memoryId)
```

---

## Open Questions (To Decide During Implementation)

1. **Ollama support?** Should we support local embedding models via Ollama for users who don't want to send data to OpenAI? Mem0 supports it — just need to expose in config.

2. **Global vs project memories?** Current plan uses project-scoped by default. Should there be a way to save cross-project memories (e.g., "user prefers TypeScript over JavaScript")?

3. **Memory UI?** OpenCode has a web UI. Should we add a memory dashboard to view/manage stored memories? Deprioritize for v1.

4. **Memory in compaction?** When OpenCode compacts long conversations, should recalled memories be included in the compaction context? Probably yes — add to `experimental.session.compacting` hook.

5. **Qdrant distribution?** Downloading a binary at runtime is convenient but may not work in all environments (corporate firewalls, air-gapped networks). Alternative: require Docker, or ship Qdrant in a companion npm package with native binaries.

---

## What NOT to Build

- No knowledge graph (Neo4j) — overkill for v1
- No dual memory systems (knowledge + reasoning) — keep it simple
- No MCP server — native integration is better
- No custom vector store implementation — Mem0 + Qdrant handle it
- No custom consolidation logic — Mem0's ADD/UPDATE/DELETE/NONE is proven
- No Agent Zero code — fresh start
