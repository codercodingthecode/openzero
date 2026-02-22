# Structured Memory System

OpenZero now supports **structured, typed memories** with rich metadata for better AI retrieval and understanding.

## Overview

Memories are now extracted as **typed objects** with specific schemas instead of plain text strings. This provides:

- **Better semantic search**: More fields to match against
- **Richer context**: Commands, file paths, error messages preserved
- **Type-specific formatting**: Bug fixes show problem + solution, workflows show commands + triggers
- **Backward compatibility**: Legacy plain-string memories still work

## Memory Types

### 1. Workflow

For repeatable processes, commands, or sequences.

```json
{
  "type": "workflow",
  "summary": "Check RAM on lab server before deployments",
  "command": "ssh lab 'free -h'",
  "trigger": "before deploying to lab box",
  "dependencies": ["SSH key configured", "host alias 'lab' in ~/.ssh/config"],
  "details": "User's lab box requires key-based authentication"
}
```

**Displays as:**

```
Check RAM on lab server before deployments | Command: `ssh lab 'free -h'` | Trigger: before deploying to lab box | Requires: SSH key configured, host alias 'lab' in ~/.ssh/config | User's lab box requires key-based authentication
```

### 2. Bug Fix

For solved problems and their solutions.

```json
{
  "type": "bug_fix",
  "summary": "Fixed TypeScript error in memory hooks",
  "symptom": "Type error: Property 'memory' does not exist on type 'MemorySearchResult'",
  "rootCause": "Missing import for MemorySchema type",
  "solution": "Added import { MemorySchema } from './schema' to hooks.ts",
  "preventionTips": "Always check imports when adding new type dependencies"
}
```

**Displays as:**

```
Fixed TypeScript error in memory hooks | Problem: Type error: Property 'memory' does not exist... | Cause: Missing import for MemorySchema type | Solution: Added import... | Prevention: Always check imports...
```

### 3. Architecture

For design decisions and system structure.

```json
{
  "type": "architecture",
  "summary": "Use Qdrant for vector storage instead of in-memory",
  "decision": "Deploy Qdrant as separate service for persistent memory",
  "rationale": "Need persistence across sessions and better scalability",
  "alternatives": ["ChromaDB (lacks production readiness)", "Pinecone (expensive)"],
  "tradeoffs": "Added deployment complexity but gained persistence and scale"
}
```

### 4. Config

For environment setup, settings, configurations.

```json
{
  "type": "config",
  "summary": "OpenRouter API key for memory LLM",
  "setting": "Memory LLM provider",
  "location": "~/.config/openzero/default.json",
  "value": "openrouter/qwen/qwen-2.5-72b-instruct",
  "purpose": "Used by mem0 for extracting facts from conversations"
}
```

### 5. Preference

For user style, tool choices, coding patterns.

```json
{
  "type": "preference",
  "summary": "User prefers Bun over npm for package management",
  "category": "tools",
  "examples": ["bun install", "bun run dev", "bun test"],
  "details": "Explicitly stated preference for speed and compatibility"
}
```

### 6. Fact

For general information that doesn't fit other categories.

```json
{
  "type": "fact",
  "summary": "The openzero repo uses 'dev' as the default branch (not 'main')",
  "details": "Local main ref may not exist; use 'dev' or 'origin/dev' for diffs",
  "keywords": ["git", "branch", "dev", "main"]
}
```

## How It Works

### Extraction (afterAssistantMessage hook)

1. **Trigger**: After each assistant reply
2. **Input**: User message + assistant message
3. **LLM Processing**: Uses `EXTRACTION_PROMPT` with structured JSON schema
4. **Output**: Array of typed memory objects
5. **Storage**: Embedded as 4096-dim vectors in Qdrant

### Retrieval (beforeUserMessage hook)

1. **Trigger**: Before processing user message
2. **Search**: Semantic search in Qdrant (user query → similar memories)
3. **Format**: Each memory formatted using `MemorySchema.format()`
4. **Injection**: Added to system prompt as "Relevant Past Context"

### Display Format

Structured memories are formatted for AI consumption:

```
# Relevant Past Context
The following information was learned from previous conversations:

1. Check RAM on lab server before deployments | Command: `ssh lab 'free -h'` | Trigger: before deploying to lab box | Requires: SSH key configured
2. User prefers Bun over npm | Category: tools | Examples: bun install; bun run dev
3. Fixed TypeScript import error | Problem: Missing type | Solution: Added import statement | Prevention: Check imports
```

## Backward Compatibility

- **Legacy memories** (plain strings) are still supported
- **Mixed collections** work seamlessly (some structured, some legacy)
- **Graceful fallback**: If JSON parsing fails, treats as plain string

## Testing

To see structured memories in action:

1. Have a conversation with specific workflows/commands
2. Check Qdrant: `curl -s http://localhost:6333/collections/openzero_memories_4096/points/scroll | jq`
3. Look for memories with structured JSON in the `data` field
4. Start a new session and reference the workflow - should be injected automatically

## Configuration

No config changes needed! The system automatically:

- Uses the configured `memory.model` for extraction
- Uses the configured `memory.embedding_model` for vectors
- Stores in the existing Qdrant collection

## Future Improvements

Potential enhancements:

- Add more memory types (test, deployment, api, etc.)
- Support for memory relationships (this workflow depends on that config)
- Memory importance scoring (boost critical memories)
- Time-based relevance decay
- Session-specific vs cross-session memories
