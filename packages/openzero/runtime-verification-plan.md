# Runtime Verification Plan for mem0.search() Metadata

## Objective

Confirm that mem0.search() returns Qdrant payload fields in `result.metadata` during actual runtime queries.

## Test Strategy

### Option 1: Use OpenCode memory_search Tool (Recommended)

**Steps:**

1. Start an OpenCode session
2. Use the `memory_search` tool to query for structured memories
3. Check logs for metadata content

**Query Examples:**

```
memory_search: workflow verification
memory_search: rebuild process
memory_search: test procedures
```

**Expected Log Output:**

```
memory search complete {
  resultCount: 3,
  durationMs: 45
}
```

**Verification Points:**

- Check if tools.ts:86 enters structured path: `m.metadata && "type" in m.metadata`
- Inspect formatted memory strings for type/details/trigger/dependencies
- Confirm no fallback to JSON parsing path (tools.ts:98)

### Option 2: Add Debug Logging

**File:** `/packages/openzero/src/tools/tools.ts`

**Add after line 83:**

```typescript
const memories = await Mem0Integration.search(memory, query, user.id, 5)
log.debug("memory search results metadata", {
  count: memories.length,
  sample: memories[0]?.metadata
    ? {
        keys: Object.keys(memories[0].metadata),
        hasType: "type" in memories[0].metadata,
        hasDetails: "details" in memories[0].metadata,
      }
    : null,
})
```

**Rebuild and restart**, then check logs for:

```
memory search results metadata {
  count: 3,
  sample: {
    keys: ["type", "details", "trigger", "dependencies", "userId", "hash", "createdAt"],
    hasType: true,
    hasDetails: true
  }
}
```

### Option 3: Direct Runtime Query

**File:** `/packages/openzero/test-runtime-search.ts`

```typescript
#!/usr/bin/env bun

import { Mem0Integration } from "./src/memory/integration"
import { Global } from "./src/global"

async function main() {
  await Global.bootstrap()

  const memory = await Mem0Integration.load()
  const userId = "9cf3b469e0dccc4f" // Replace with actual user ID

  console.log("Searching for structured memories...")
  const results = await Mem0Integration.search(memory, "workflow", userId, 5)

  console.log(`\nFound ${results.length} results:\n`)

  for (const r of results) {
    console.log(`Memory: ${r.memory.substring(0, 80)}...`)
    console.log(`Metadata keys: ${Object.keys(r.metadata || {}).join(", ")}`)
    console.log(`Has 'type': ${r.metadata && "type" in r.metadata}`)
    if (r.metadata && "type" in r.metadata) {
      console.log(`  type: ${r.metadata.type}`)
      console.log(`  details: ${r.metadata.details}`)
      console.log(`  trigger: ${r.metadata.trigger}`)
    }
    console.log()
  }
}

main()
```

## Expected Results

### ✅ SUCCESS Indicators

1. `m.metadata` contains keys: `type, details, trigger, dependencies, userId, hash, createdAt`
2. tools.ts enters structured formatting path (line 86)
3. Formatted memories show: `[workflow] Trigger: ... Details: ... Dependencies: ...`

### ❌ FAILURE Indicators

1. `m.metadata` is empty or only contains `{userId, hash}`
2. tools.ts falls back to JSON parsing path (line 98)
3. Memories formatted as plain text or parsed JSON strings

## Troubleshooting

### If metadata is empty:

- **Issue:** mem0 Python library may not be returning Qdrant payload in metadata field
- **Solution:** Check mem0 version, review mem0 source code for payload handling
- **Workaround:** Directly query Qdrant in tools.ts instead of using mem0.search()

### If metadata only has userId/hash:

- **Issue:** mem0 may be filtering payload fields before returning
- **Solution:** Inspect mem0 TypeScript bindings for field mapping
- **Workaround:** Modify mem0.ts to merge Qdrant payload into result.metadata

### If structured formatting fails:

- **Issue:** Metadata structure doesn't match expected schema
- **Solution:** Add type guards and validation in tools.ts
- **Fix:** Update isStructured() to handle variations in metadata structure

## Next Actions

1. **Choose verification method** (Option 1 recommended)
2. **Execute test** and capture logs/output
3. **Confirm metadata presence** in mem0.search() results
4. **Document findings** in phase3-complete.md
5. **Mark Phase 3 as verified** if metadata propagation confirmed

## Success Criteria

- [ ] mem0.search() returns `result.metadata` with structured fields
- [ ] tools.ts:86 check passes: `m.metadata && "type" in m.metadata`
- [ ] Structured memories formatted correctly in tool output
- [ ] No fallback to JSON parsing for structured memories
- [ ] Backward compatibility maintained for legacy memories

---

**Status:** Ready for runtime verification  
**Blocker:** None — code paths implemented and tested against Qdrant  
**Risk:** Low — mem0 documentation confirms metadata propagation  
**Estimated Time:** 5 minutes for Option 1, 10 minutes for Option 2/3
