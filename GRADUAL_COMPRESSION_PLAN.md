# Gradual History Compression Implementation Plan

**Goal:** Replace blocking compaction with Agent Zero–style gradual background compression.

## Current State (Blocking Compaction)

- When context overflows, triggers a **blocking** compaction agent
- Rewrites entire session into a single summary message
- Prunes old tool outputs
- User waits for this to complete

## Target State (Gradual Compression)

- **Background** summarization after each turn
- Keeps recent N messages raw (e.g., last 5–10 turns)
- Older messages compressed into rolling "history summary" text
- Memory (Mem0) stores important facts separately
- No blocking "compact" operation

## Implementation Steps

### 1. Schema Changes

**File:** `packages/openzero/src/session/session.sql.ts`

Add `history_summary` column to `SessionTable`:

```ts
history_summary: text()
```

**File:** `packages/openzero/src/session/index.ts`

Add `historySummary` to `Session.Info` type and `fromRow`/`toRow` functions.

### 2. Enable Compression Module

**File:** `packages/openzero/src/session/compression.ts`

- Remove early return in `maybeCompress`
- Implement `summarizeMessages` with proper LLM call (using streamText + Provider API)
- Wire up session update to save `historySummary`

### 3. Hook Compression into Session Flow

**File:** `packages/openzero/src/session/processor.ts`

After assistant response completes, call:

```ts
await SessionCompression.maybeCompress({ sessionID, model })
```

This runs async in background, doesn't block the user.

### 4. Update Prompt Construction

**File:** `packages/openzero/src/session/prompt.ts`

Modify `buildPrompt` to inject:

1. `[history summary]` (if exists)
2. `[recent N raw messages]`

Instead of all raw messages.

### 5. Disable Old Compaction

**File:** `packages/openzero/src/config/config.ts`

Set default:

```ts
compaction: {
  auto: false, // Disable old blocking compaction
  prune: true,  // Keep pruning for now
}
```

### 6. Migration

**Generate:** `bun run db generate --name add_history_summary`

Creates migration to add `history_summary` column to existing sessions.

## Benefits

- ✅ No blocking waits for "compaction"
- ✅ Memory stores facts (via Mem0), history stores context
- ✅ Gradual compression keeps recent messages fresh
- ✅ Matches Agent Zero's proven approach

## Next Steps (After Schema)

1. Run migration: `bun run db migrate`
2. Enable compression in `compression.ts`
3. Test with long conversations
4. Monitor compression timing logs
5. Tune `MIN_RECENT_MESSAGES` and token ratios based on usage

## Config Knobs (Future)

```ts
experimental: {
  compression: {
    enabled: true,
    recentMessages: 5, // Keep last N raw
    tokenRatios: {
      recent: 0.6,
      summary: 0.3,
      buffer: 0.1,
    },
  },
}
```
