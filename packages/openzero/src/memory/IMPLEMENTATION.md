# Custom Extraction Pipeline Implementation

## Overview

Replaced `infer:true` with custom extraction pipeline that preserves structured metadata while leveraging mem0's deduplication and storage logic.

## Architecture

```
User ↔ Assistant conversation
    ↓
afterAssistantMessage hook
    ↓
[1] extractStructuredFacts (extraction.ts)
    - Calls LLM with EXTRACTION_PROMPT
    - Returns typed structured memory objects
    ↓
[2] For each structured fact:
    memory.add(summary, { infer: false, metadata: {...} })
    ↓
[3] Mem0 handles:
    - Embedding generation
    - Search for similar existing memories
    - Deduplication (ADD/UPDATE/DELETE decision)
    - Write to Qdrant with full metadata
    ↓
Qdrant stores:
{
  data: "User checks RAM on lab server",  // For semantic search
  metadata: {
    type: "workflow",
    command: "ssh lab 'free -h'",
    trigger: "before deployment",
    ...all structured fields
  }
}
```

## Files Modified

### 1. `/src/memory/extraction.ts` (NEW)

**Purpose**: Custom LLM extraction with structured output

**Key Functions**:

- `extractStructuredFacts(messages, memoryModel)`:
  - Formats conversation messages
  - Calls LLM with EXTRACTION_PROMPT
  - Parses JSON response
  - Validates structured memory schemas
  - Returns array of typed memories

**Features**:

- Uses `experimental_output: "json_object"` for guaranteed JSON
- Strips code blocks from LLM responses
- Validates each fact against MemorySchema
- Detailed error logging

### 2. `/src/memory/hooks.ts`

**Changes**: Replaced `infer:true` extraction with custom pipeline

**Before**:

```typescript
await Mem0Integration.add(memory, messages, userId, { infer: true })
```

**After**:

```typescript
// Extract structured facts ourselves
const facts = await extractStructuredFacts(messages, memoryModel)

// Store each fact with structured metadata
for (const fact of facts) {
  await Mem0Integration.add(memory, fact.summary, userId, {
    infer: false,
    metadata: { type: fact.type, command: fact.command, ... }
  })
}
```

**Benefits**:

- Full control over extraction
- Structured metadata preserved
- Mem0 still handles deduplication

### 3. `/src/memory/mem0.ts`

**Changes**: Updated `add()` to support metadata parameter

**Signature**:

```typescript
add(
  memory: Memory,
  messages: string | any[],
  userId: string,
  options: { infer?: boolean; metadata?: Record<string, any> }
)
```

**When `infer: false`**:

- `messages` must be a string (the summary text)
- `metadata` contains all structured fields
- Mem0 skips extraction, goes straight to dedup + storage

### 4. `/src/memory/tools.ts`

**Changes**: Enhanced to use structured metadata from Qdrant

**Priority Order**:

1. Check `metadata` field for structured data (new)
2. Try parsing `memory` text as JSON (fallback)
3. Use plain text (legacy)

**Improvement**:

- AI can see all structured fields (command, trigger, etc.)
- Better formatted output for workflows, bug fixes, etc.

### 5. `/src/memory/plugin.ts`

**Changes**: Pass `memoryConfig` to `afterAssistantMessage` hook

Now the hook can access the configured LLM model for extraction.

## Memory Types Supported

All memory types from `schema.ts`:

1. **Workflow**: Commands, processes, sequences
   - Fields: `command`, `trigger`, `dependencies`
2. **Bug Fix**: Solved problems and solutions
   - Fields: `symptom`, `rootCause`, `solution`, `preventionTips`
3. **Architecture**: Design decisions and rationale
   - Fields: `decision`, `rationale`, `alternatives`, `tradeoffs`
4. **Preference**: User coding style and tool choices
   - Fields: `category`, `examples`
5. **Config**: Environment setup and settings
   - Fields: `setting`, `value`, `location`, `purpose`
6. **Fact**: Generic information
   - Fields: Just base fields (summary, details)

## Data Flow Example

### Input Conversation:

```
User: How do I check RAM on my lab server?
Assistant: You can SSH into the lab box and run `free -h`
```

### Extraction (LLM Response):

```json
{
  "facts": [
    {
      "type": "workflow",
      "summary": "User checks RAM on lab server via SSH",
      "command": "ssh lab 'free -h'",
      "trigger": "before deployments",
      "dependencies": ["SSH key configured"],
      "details": "Lab box is accessible via 'ssh lab' host alias"
    }
  ]
}
```

### Storage (Qdrant Document):

```json
{
  "id": "uuid",
  "vector": [0.123, -0.456, ...],  // Embedding of summary
  "payload": {
    "data": "User checks RAM on lab server via SSH",
    "user_id": "user123",
    "hash": "md5hash",
    "created_at": "2026-02-22T...",
    "type": "workflow",
    "command": "ssh lab 'free -h'",
    "trigger": "before deployments",
    "dependencies": ["SSH key configured"],
    "details": "Lab box is accessible via 'ssh lab' host alias"
  }
}
```

### Retrieval (memory_search tool):

```
1. [ID: uuid] User checks RAM on lab server via SSH | Command: `ssh lab 'free -h'` | Trigger: before deployments | Requires: SSH key configured
   Score: 0.92
```

## Benefits

1. **Full Control**: We own the extraction prompt and parsing
2. **Structured Data**: Rich metadata for filtering and joins
3. **Deduplication**: Mem0 handles the hard logic
4. **Backward Compatible**: Plain text memories still work
5. **Better Retrieval**: Structured fields improve AI context
6. **No Fork Needed**: Uses standard mem0 API

## Testing Plan

### 1. Extract Structured Facts

**Test**: Have a conversation with workflow info

**Expected**:

- Logs show `"extracted structured facts"` with count and types
- LLM returns JSON with structured objects
- Validation passes

**Check**:

```bash
tail -f ~/.local/share/openzero/logs/openzero.log | grep "memory-extraction"
```

### 2. Verify Qdrant Storage

**Test**: Query Qdrant directly

**Command**:

```bash
curl http://localhost:6333/collections/openzero_memories_4096/points/scroll -X POST -H "Content-Type: application/json" -d '{"limit": 1, "with_payload": true, "with_vector": false}'
```

**Expected**:

- Points have `metadata.type`, `metadata.command`, etc.
- `payload.data` contains summary text
- All structured fields present

### 3. Verify Deduplication

**Test**: Add similar memory twice

**Expected**:

- First add creates new memory
- Second add triggers UPDATE (not duplicate)
- Logs show `"saved structured memories"` with count = 1

### 4. Verify Retrieval

**Test**: Use `memory_search` tool

**Expected**:

- Returns formatted structured memories
- Shows command, trigger, etc. for workflows
- Shows symptom, solution for bug fixes

## Next Steps

1. **Rebuild OpenCode**: `cd packages/opencode && ./script/install`
2. **Restart**: New code will be loaded
3. **Test**: Have a conversation with technical details
4. **Verify**: Check logs, Qdrant data, and retrieval

## Rollback Plan

If issues arise:

1. Revert hooks.ts to use `infer: true`
2. Remove extraction.ts import
3. Remove metadata parameter from add() calls
4. Structured memories already in Qdrant will still work (backward compatible)
