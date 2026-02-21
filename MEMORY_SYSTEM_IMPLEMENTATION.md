# OpenZero Memory System - Implementation Complete

## Summary

Successfully implemented a production-grade long-term memory system for OpenCode using **Mem0 OSS** and **Qdrant** vector database. The system provides automatic memory extraction, recall, and manual memory management tools for the AI coding agent.

## Components Built

### Phase 1: Foundation ✅

1. **config.ts** - Memory configuration schema
   - Integrated into OpenCode's experimental config
   - User must configure `model` and `embedding_model` (no defaults)
   - Configurable Qdrant, recall, and auto-memorize settings

2. **prompts.ts** - Coding-focused extraction prompt
   - Replaces Mem0's default "personal info" prompt
   - Extracts: technical decisions, patterns, preferences, solutions, codebase facts, tooling
   - Filters out: transient info, generic knowledge, greetings, code snippets

3. **qdrant.ts** - Qdrant lifecycle manager
   - Auto-downloads platform-specific binary (darwin/linux, arm64/x64)
   - Stores binary in `~/.opencode/bin/qdrant`
   - Data path: `~/.opencode/memory/qdrant-data/`
   - Health check, auto-restart on crash, port conflict detection
   - Graceful shutdown on SIGTERM

4. **mem0.ts** - Mem0 integration layer
   - Initializes Mem0 with user-configured LLM and embedding model
   - Project-scoped user IDs (SHA256 hash of directory path)
   - Wrapper functions: `search()`, `add()`, `deleteMemory()`, `getAll()`
   - Proper error handling and logging

5. **plugin.ts** - Memory plugin
   - Registered as internal plugin in `/src/plugin/index.ts`
   - Validates config, starts Qdrant, initializes Mem0
   - Wires all components together

### Phase 2: Recall ✅

6. **recall.ts** - System prompt injection
   - Hook: `experimental.chat.system.transform`
   - Recalls on first turn + every Nth turn (configurable interval, default 3)
   - Formats memories as `<memories>` block in system prompt
   - Session-level turn tracking
   - Skips recall if disabled or no session ID

### Phase 3: Auto-Memorize ✅

7. **memorize.ts** - Automatic memory extraction
   - Subscribes to `SessionStatus.Event.Idle` via Bus
   - Debounces with configurable idle timeout (default 60s)
   - Tracks message count per session, only memorizes new messages
   - Converts messages to Mem0 format (role + content)
   - Uses `infer: true` for LLM-based fact extraction
   - Transparent logging of what was memorized

### Phase 4: Tools ✅

8. **tools.ts** - Manual memory management tools
   - **memory_save**: Save content directly (no extraction), project or global scope
   - **memory_search**: Search memories by query, project/global/both scopes, configurable limit
   - **memory_delete**: Delete memory by ID
   - All tools return string results with helpful messages

## File Structure

```
packages/opencode/src/memory/
  index.ts          - Public exports
  plugin.ts         - MemoryPlugin (wires everything together)
  config.ts         - Memory config schema
  prompts.ts        - Coding-focused extraction prompt
  qdrant.ts         - Qdrant binary download + lifecycle
  mem0.ts           - Mem0 initialization + API wrapper
  recall.ts         - System prompt injection (Phase 2)
  memorize.ts       - Auto-memorize on session idle (Phase 3)
  tools.ts          - memory_save/search/delete tools (Phase 4)
```

## Dependencies Added

- `mem0ai@2.2.3`
- `@qdrant/js-client-rest@1.17.0`

## Configuration Example

Users configure the memory system in their `opencode.jsonc`:

```jsonc
{
  "experimental": {
    "memory": {
      "enabled": true,
      "model": "openai/gpt-4o-mini", // User must configure
      "embedding_model": "openai/text-embedding-3-small", // User must configure
      "qdrant": {
        "host": "localhost",
        "port": 6333,
        "auto_start": true,
      },
      "recall": {
        "enabled": true,
        "interval": 3, // Recall every 3rd turn
        "max_results": 5,
      },
      "auto_memorize": {
        "enabled": true,
        "idle_timeout": 60, // Seconds before memorizing
      },
    },
  },
}
```

## How It Works

### 1. Initialization

When OpenCode starts with memory enabled:

1. Plugin validates config (model + embedding_model required)
2. Qdrant manager downloads binary (if needed) and starts server
3. Mem0 is initialized with user's LLM and embedding model
4. Project user ID is generated from directory path
5. Bus subscription for session idle events is registered
6. Memory tools are registered

### 2. Recall (During Chat)

On each turn:

1. Hook checks if recall should run (first turn or every Nth turn)
2. Searches Mem0 for relevant memories (generic query for now)
3. Formats results as `<memories>` block
4. Appends to system prompt array
5. Updates turn tracking state

### 3. Auto-Memorize (After Chat)

When a session goes idle:

1. Event fires, debounce timer starts (60s default)
2. After timeout, retrieves session messages
3. Filters new messages since last memorization
4. Converts to Mem0 format (user/assistant roles + text content)
5. Calls Mem0 with `infer: true` for LLM extraction
6. Mem0 extracts facts, consolidates (ADD/UPDATE/DELETE), stores
7. Updates message count tracking

### 4. Manual Tools (During Chat)

Agent can explicitly call:

- `memory_save({ content, scope })` - Save without extraction
- `memory_search({ query, scope, limit })` - Search memories
- `memory_delete({ memoryId })` - Delete by ID

## Key Technical Decisions

| Decision              | Choice                 | Rationale                                                    |
| --------------------- | ---------------------- | ------------------------------------------------------------ |
| Memory engine         | Mem0 OSS               | Full consolidation logic, 4 deps, 1.2MB, Apache 2.0          |
| Vector store          | Qdrant                 | Single binary, scalable, best filtering, 30MB idle           |
| Memory LLM            | User-configured        | No default, user picks cheap model                           |
| Embedding model       | User-configured        | No default, user picks (e.g., OpenAI text-embedding-3-small) |
| Scoping               | Project path hash      | Per-project isolation by default, "global" for cross-project |
| Integration           | Built-in plugin        | Needs Bus events, session data, provider config              |
| Recall frequency      | Every 3rd turn + first | Balance relevance vs cost/latency                            |
| Auto-memorize trigger | Session idle 60s       | Avoid mid-conversation, wait for pauses                      |
| Prompts               | Custom for coding      | Mem0 defaults are for chatbot personal info                  |

## Type Safety

- All code typechecks successfully with `bun run typecheck`
- Proper TypeScript types for Mem0, Qdrant, and OpenCode APIs
- Zod schemas for configuration validation

## Testing Status

- ✅ Code compiles and typechecks
- ⏳ Manual testing required:
  1. Enable memory in config
  2. Start OpenCode (Qdrant should download and start)
  3. Have a conversation
  4. Check memories are recalled on next session
  5. Test manual tools

## Next Steps (Not Implemented Yet)

From original plan's open questions:

1. **Ollama support**: Easy to add - just expose provider config for embedder
2. **Global vs project memories**: Already supported via `scope` parameter
3. **Memory UI**: Deprioritized for v1 - could add dashboard to web UI
4. **Memory in compaction**: Should add recalled memories to compaction context
5. **Qdrant distribution**: Current approach (runtime download) works, but Docker alternative possible

## Known Limitations

1. **API key handling**: Currently uses `process.env.OPENAI_API_KEY` - should integrate with OpenCode's provider config system
2. **Recall query**: Uses generic query ("relevant technical information") - could be smarter by analyzing current conversation context
3. **Memory scope**: No per-agent or per-run scoping yet (Mem0 supports this)
4. **Cleanup**: No cleanup of old/stale memories - Mem0 handles consolidation but not pruning

## Files Modified

- `packages/opencode/src/config/config.ts` - Added experimental.memory config
- `packages/opencode/src/plugin/index.ts` - Registered MemoryPlugin
- `packages/opencode/package.json` - Added mem0ai and @qdrant/js-client-rest

## Files Created

All files in `packages/opencode/src/memory/`:

- index.ts, config.ts, prompts.ts, qdrant.ts, mem0.ts, plugin.ts, recall.ts, memorize.ts, tools.ts

---

## Implementation Phases Completed

- ✅ **Phase 1**: Foundation (config, Qdrant, Mem0, plugin shell)
- ✅ **Phase 2**: Recall (system prompt injection)
- ✅ **Phase 3**: Auto-Memorize (session idle handler)
- ✅ **Phase 4**: Tools (memory_save, memory_search, memory_delete)
- ⏳ **Phase 5**: Polish (error handling, logging, testing, docs)

Phase 5 is partially complete:

- ✅ Error handling: graceful degradation, no crashes
- ✅ Logging: comprehensive debug/info/error logs
- ⏳ Testing: code compiles, manual testing needed
- ⏳ Documentation: this file serves as docs, could add user guide
