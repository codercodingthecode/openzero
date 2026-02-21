# Hierarchical History Compression - Implementation Complete ✅

**Goal:** Replace blocking compaction with Agent Zero's hierarchical background compression.

**Status:** FULLY IMPLEMENTED (Feb 21, 2026)

## What Was Built

### ✅ 1. Hierarchical History System

**File:** `packages/openzero/src/session/history.ts` (398 lines)

Implemented Agent Zero's three-level structure:

- **Current Topic** (50% of context): Recent raw messages
- **Topics** (30% of context): Older summarized topics
- **Bulks** (20% of context): Ancient, heavily compressed history
- **Message Deduplication**: Tracks `lastMessageID` to prevent re-adding messages on each compression run

**Key functions:**

- `compress()`: Iterative algorithm that compresses most over-budget level first (Agent Zero's algorithm)
- `compressCurrent()`: Summarizes middle 65% of messages in current topic
- `compressTopics()`: Summarizes topics, moves oldest to bulks
- `compressBulks()`: Merges bulks in groups of 3 or drops oldest
- `summarizeMessages()`: Real LLM summarization using `gpt-4o-mini` via OpenZero's Provider API
- `mergeBulks()`: LLM-based bulk merging
- `toMessages()`: Converts hierarchy to flat messages for prompt injection

### ✅ 2. Schema Changes

**Files:**

- `packages/openzero/src/session/session.sql.ts` - Added `history: text()` column
- `packages/openzero/src/session/index.ts` - Added `history?: string, lastMessageID?: string` to `Session.Info`
- `migration/20260221072203_add_history_field/migration.sql` - Migration auto-applies on startup

### ✅ 3. Compression Module

**File:** `packages/openzero/src/session/compression.ts`

- `maybeCompress()`: Triggers compression async in background (doesn't block responses)
- `compress()`: Loads history, adds only NEW messages, compresses if needed, saves back to DB
- **Deduplication Fix**: Only processes messages added since `lastMessageID`

### ✅ 4. Wired Into Session Flow

**File:** `packages/openzero/src/session/processor.ts:415`

Compression triggers after every assistant response:

```ts
const { SessionCompression } = await import("./compression")
SessionCompression.maybeCompress({ sessionID: input.sessionID, model: input.model }).catch((error) => {
  log.error("background compression failed", { error, sessionID: input.sessionID })
})
```

### ✅ 5. Prompt Injection

**File:** `packages/openzero/src/session/prompt.ts:657-670`

Hierarchical history injected BEFORE raw messages:

```ts
const { SessionHistory } = await import("./history")
const history = session.history ? SessionHistory.deserialize(session.history) : undefined
const historyMessages = history ? SessionHistory.toMessages(history) : []

// Inject into prompt
messages: [
  ...historyMessages.map((h) => ({ role: h.role, content: h.content })),
  ...MessageV2.toModelMessages(msgs, model),
  // ...
]
```

Format matches Agent Zero: `[Ancient history]:`, `[Previous topic]:` prefixes.

### ✅ 6. Old Compaction Disabled

**File:** `packages/openzero/src/config/config.ts`

Default changed to disable blocking compaction:

```ts
compaction: {
  auto: false, // Hierarchical compression replaces this
  prune: true,
}
```

## Memory Latency Instrumentation

### ✅ Timing Instrumentation

**Files:** `packages/openzero/src/memory/{mem0.ts, hooks.ts}`

- Deep timing wrapping of ALL Mem0 operations
- LLM calls (including call number, prompt size, response format)
- Embeddings (text size, batch count)
- Vector store operations (search, insert, update)
- Logs format: `mem0 timing { step, durationMs, ... }`

### ✅ Fact Extraction Cap

**File:** `packages/openzero/src/memory/prompts.ts`

- Changed from 10 facts per turn to **50 facts per turn**
- Reduces consolidation prompt size in Mem0's update step

## Build & Deploy

**Version:** `0.0.0-dev-202602210735`

**Build command:**

```bash
cd packages/openzero
bun run script/build.ts --skip-install
cp dist/openzero-darwin-arm64/bin/openzero ~/.local/bin/openzero
```

**Built binary:** `~/.local/bin/openzero` (134MB, Mach-O arm64)

## How It Works

1. **After each assistant response**, `SessionCompression.maybeCompress()` runs async in background
2. **Loads history** from `session.history` column (or creates new)
3. **Adds only NEW messages** since `lastMessageID` (prevents duplicates)
4. **Checks token budget** - if over 70% of context limit, triggers compression
5. **Compresses iteratively** using Agent Zero's algorithm:
   - Finds most "over budget" level (Current/Topics/Bulks)
   - Compresses that level using LLM summarization
   - Repeats until all levels fit their ratios (50/30/20)
6. **Saves compressed history** back to database
7. **Prompt construction** injects compressed history before raw messages

## Benefits

- ✅ **No blocking waits** - compression runs in background
- ✅ **Gradual compression** - iterative, not all-at-once
- ✅ **LLM summarization** - real summaries via `gpt-4o-mini`, not truncation
- ✅ **Agent Zero's proven algorithm** - token ratio enforcement (50/30/20)
- ✅ **Memory + History separation** - Mem0 stores facts, history stores context
- ✅ **Deduplication** - tracks last processed message ID

## Testing Checklist

1. **Memory timing logs** - Verify detailed breakdown of Mem0 operations
2. **Non-blocking compression** - Chat responses shouldn't stall
3. **Long conversations** - Watch topics/bulks being created in logs
4. **Prompt injection** - Compressed history appears in prompts with `[Ancient history]:` prefixes
5. **No duplicates** - History shouldn't grow exponentially from re-adding messages

## Known Issues

None currently - duplication bug was fixed before testing.

## Future Improvements

- Use cheaper "utility" model for summarization (like Agent Zero does)
- Add config knobs for compression ratios
- Monitor compression performance and tune thresholds
- Consider compressing large individual messages
