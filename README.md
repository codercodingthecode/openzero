<p align="center">
  <h1 align="center">OpenZero</h1>
</p>
<p align="center"><strong>The AI coding agent that never forgets.</strong></p>
<p align="center">
  <a href="#"><img alt="Version" src="https://img.shields.io/badge/version-[VERSION_PLACEHOLDER]-blue.svg" /></a>
  <a href="#"><img alt="License" src="https://img.shields.io/badge/license-[LICENSE_PLACEHOLDER]-green.svg" /></a>
</p>

---

## What Is OpenZero

OpenZero is a self-hostable, open-source AI development environment that solves the two deepest problems in today's AI coding assistants: **they forget everything between sessions**, and **they choke on long conversations**.

Most tools deal with this by silently truncating history. The result is an assistant that has no idea what it told you yesterday, re-discovers the same bugs, and loses track of architectural decisions mid-project. OpenZero takes a fundamentally different approach.

Built as a fork of the [OpenCode](https://github.com/anomalyco/opencode) project, OpenZero introduces two major systems that work together:

1. A **Structured Memory System** that continuously extracts, categorizes, and stores project knowledge in a vector database, making it retrievable across any session.
2. A **Hierarchical Context Compression** engine that manages the active conversation with a three-tier summarization architecture, allowing effectively unlimited conversation length without hitting context limits.

The result is an AI assistant that accumulates institutional knowledge the longer you use it -- and never loses it.

---

## Structured Memory System

### The Problem

Every modern AI coding assistant treats conversation history as a flat, disposable text stream. When the context window fills up, old messages are truncated and gone forever. This means:

- Architectural decisions made in Week 1 are invisible by Week 3.
- The same bug gets re-investigated because the fix was in a prior session.
- User preferences (naming conventions, framework choices, deployment workflows) must be repeated endlessly.

### The Solution

OpenZero runs a continuous background pipeline that monitors every exchange, evaluates whether it contains durable knowledge, and if so, extracts it into a typed, schema-validated record stored in a high-dimensional vector space. This pipeline operates after every assistant response and is completely non-blocking.

The extraction is not a black-box -- OpenZero uses a custom LLM-driven extraction prompt (replacing the default inference approach) that produces structured JSON output validated against strict type schemas. This gives full control over what gets extracted and how it is categorized.

### Memory Types

All extracted knowledge is classified into one of six strictly typed schemas. This typing is critical: it allows the retrieval engine to understand the _nature_ of the knowledge being injected, not just its text similarity.

| Type             | What It Captures                                       | Tracked Metadata                                                                |
| :--------------- | :----------------------------------------------------- | :------------------------------------------------------------------------------ |
| **Workflow**     | Repeatable commands and operational processes          | Command string, trigger conditions, upstream dependencies                       |
| **Bug Fix**      | Solved problems and their post-mortems                 | Observable symptom, confirmed root cause, applied solution, prevention guidance |
| **Architecture** | Significant design decisions                           | The decision itself, the rationale, alternatives considered, known tradeoffs    |
| **Preference**   | User coding styles and tool choices                    | Category of preference, concrete examples demonstrating it                      |
| **Config**       | Environment settings and infrastructure variables      | Setting name, current value, physical location, business purpose                |
| **Fact**         | General project knowledge that doesn't fit other types | Free-form detail, semantic keywords for retrieval                               |

### Extraction, Storage, and Retrieval

The pipeline operates in three phases:

**Extraction** -- After each assistant response, the conversation is evaluated by an LLM using a purpose-built extraction prompt. The LLM outputs structured JSON, which is parsed, validated against the six schemas, and tagged with deduplication hashes and timestamps. Up to 10 facts are extracted per conversation turn.

**Storage** -- Each validated memory is embedded into a 4096-dimensional vector (using Qwen3-Embedding-8B via OpenRouter) and inserted into a Qdrant vector collection. Before insertion, the system performs algorithmic deduplication: if a semantically similar memory already exists, it is updated or merged rather than duplicated.

**Retrieval** -- Before every user message is processed by the LLM, the system performs a cosine-similarity search against the vector store, filtered by user ID. The top results are formatted using type-specific templates and injected into the system prompt as structured historical context. The entire retrieval path completes in under 200ms.

```text
 Conversation
      │
      ▼
 Extraction (LLM evaluation + schema validation)
      │
      ▼
 Embedding (4096-dim vectorization + deduplication)
      │
      ▼
 Qdrant (persistent vector storage with rich metadata)
      │
      ▼
 Retrieval (semantic search → type-aware formatting → prompt injection)
```

### Data Isolation and Privacy

All memories are partitioned by a hashed user ID. Every Qdrant query is filtered by this ID, ensuring strict per-user isolation. There is no cross-user memory access, and metadata is scrubbed of personally identifiable information during extraction.

---

## Hierarchical Context Compression

### The Problem

Even with long-context models (100k+ tokens), extended development sessions eventually exhaust the context window. The default behavior in most tools is blind truncation: the oldest messages are silently dropped. This destroys continuity mid-task and forces the user to re-explain context.

### The Solution

OpenZero replaces truncation with intelligent, AI-driven hierarchical compression. The active session history is divided into three tiers, each with a strictly enforced token budget ratio. As the conversation grows, older content is progressively summarized and demoted through the tiers, preserving the essential information while dramatically reducing token consumption.

### The Three Tiers

| Tier        | Budget Allocation     | Content                                      | Fidelity                            |
| :---------- | :-------------------- | :------------------------------------------- | :---------------------------------- |
| **Current** | 50% of history budget | Most recent exchanges                        | Full, uncompressed messages         |
| **Topics**  | 30% of history budget | Summarized blocks of older related exchanges | Medium-detail LLM summaries         |
| **Bulks**   | 20% of history budget | Ancient project history, heavily compressed  | Ultra-compact, high-level summaries |

When the Current tier overflows its budget, its oldest messages are bundled, summarized by the LLM into a cohesive "topic" block, and moved into the Topics tier. When the Topics tier overflows, its oldest blocks are merged and compressed into the Bulks tier. Content flows strictly downward through the hierarchy.

### The Compression Algorithm

The compression engine runs asynchronously after every assistant response and follows a strict protocol:

1. **Token Evaluation** -- The total token count of the session history is computed.
2. **Threshold Gate** -- If the total is below **70%** of the model's absolute context limit, no action is taken.
3. **Budget Audit** -- If the threshold is exceeded, the engine calculates exactly which tier is most severely over its allocated ratio.
4. **Targeted Summarization** -- The most over-budget tier is compressed first. Its oldest entries are summarized by the LLM and pushed down the hierarchy.
5. **Stabilization Loop** -- Steps 3-4 repeat iteratively until all three tiers fit within their budget ratios.

This produces compression ratios of 60-80% on older messages while maintaining 100% fidelity on the most recent exchanges. Compression state is persisted in SQLite, so a session can be resumed without re-computing.

### Legacy System Removal

As part of the OpenZero architectural overhaul, the baseline project's original compaction system was completely removed. That system operated as a parallel, uncoordinated process that triggered independently and had no integration with the new hierarchical pipeline. All trigger logic, result handlers, and supporting imports were eradicated. OpenZero now relies exclusively on the unified three-tier compression engine described above.

---

## System Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                        User Interface                            │
│                     (TUI / Web App / API)                        │
└─────────────┬───────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Session Manager                              │
│  - Message routing and context assembly                         │
│  - Active history management and exchange windowing             │
│  - Asynchronous lifecycle hook orchestration                    │
└──────┬──────────────────────────┬───────────────────────────────┘
       │                          │
       ▼                          ▼
┌──────────────────┐      ┌──────────────────┐
│  Memory System   │      │  Compression     │
│  - Extraction    │      │  - 3-tier engine  │
│  - Vector store  │      │  - Token budgets │
│  - Retrieval     │      │  - State persist │
└──────┬───────────┘      └──────┬───────────┘
       │                          │
       ▼                          ▼
┌──────────────────┐      ┌──────────────────┐
│  Qdrant          │      │  SQLite          │
│  (Vectors)       │      │  (State/Config)  │
└──────────────────┘      └──────────────────┘
```

### Hook-Driven Lifecycle

OpenZero's memory and compression systems are integrated via a lifecycle hook mechanism:

- **beforeUserMessage** -- Retrieves semantically relevant memories from Qdrant and injects them as structured context into the system prompt.
- **afterAssistantMessage** -- Extracts structured facts from the conversation, validates them, and stores them in the vector database. Simultaneously triggers the background compression engine to evaluate whether the session history needs compaction.

This hook architecture is exposed through a plugin system, allowing third-party extensions to register their own pre- and post-processing logic.

### Technology Stack

| Layer               | Technology                            | Role                                                                   |
| :------------------ | :------------------------------------ | :--------------------------------------------------------------------- |
| Runtime             | Bun                                   | JavaScript execution, file I/O, process management                     |
| Language            | TypeScript                            | Type safety across the entire codebase                                 |
| Vector Database     | Qdrant                                | Persistent storage and cosine-similarity search for memory embeddings  |
| Relational Database | SQLite (via Drizzle ORM)              | Session state, compression state, configuration, provider registry     |
| Memory Framework    | mem0                                  | Embedding generation, deduplication logic, memory lifecycle management |
| LLM Providers       | OpenRouter, Anthropic, OpenAI, Google | Inference for extraction, summarization, and primary chat              |
| Embedding Model     | Qwen3-Embedding-8B (4096-dim)         | High-fidelity vector representations for semantic search               |
| Frontend            | Solid.js, Tauri                       | Optional TUI and desktop application interfaces                        |

### Performance

All memory and compression operations run outside the critical chat path. The following are measured targets:

| Operation                 | Latency   | Notes                                            |
| :------------------------ | :-------- | :----------------------------------------------- |
| Embedding generation      | 100-300ms | Model and network dependent                      |
| Vector search (retrieval) | <200ms    | Qdrant cosine similarity, filtered by user ID    |
| Context formatting        | <10ms     | Pure computation, no I/O                         |
| Token counting            | <50ms     | Cached tokenizer                                 |
| Compression state save    | <50ms     | SQLite write                                     |
| Full extraction pipeline  | 2-5s      | LLM-dependent, runs asynchronously in background |

### Resilience

The extraction pipeline uses exponential-backoff retries with a three-level fallback: structured extraction, then plain-text extraction, then graceful skip with error logging. The retrieval pipeline similarly falls back from full vector search to simple text search to empty results. Neither subsystem can crash or block the primary chat loop.

---

## Configuration

OpenZero ships with a SQLite-backed settings system (migrated from the baseline project's JSON cache files) that provides ACID-compliant transactional updates and proper concurrency control.

### Memory Settings

Memory behavior is fully configurable via the TUI settings panel or the project configuration file:

- **Enabled/Disabled** -- Toggle the entire memory pipeline on or off.
- **Extraction Model** -- The LLM used for structured fact extraction (default: Qwen 2.5 72B Instruct via OpenRouter).
- **Embedding Model** -- The model used to generate vector embeddings (default: Qwen3-Embedding-8B, 4096 dimensions).
- **Fact Limit** -- Maximum number of memories extracted per conversation turn (default: 10).
- **Similarity Threshold** -- Minimum cosine similarity score for retrieval results (default: 0.7).
- **Qdrant Connection** -- URL, collection name, and vector dimensionality for the Qdrant instance.

### Compression Settings

- **Tier 1 Window** -- Number of recent exchanges kept at full fidelity (default: 3).
- **Tier 2 Window** -- Number of exchanges summarized at medium detail (default: 7).
- **Compression Model** -- The LLM used for summarization (default: Qwen 2.5 72B Instruct via OpenRouter).
- **Context Limit** -- Maximum context tokens before compression triggers (model-dependent).
- **Target Ratio** -- The 70% threshold that governs when compression activates.

---

## What Changed from OpenCode

OpenZero is a substantial engineering effort on top of the OpenCode baseline. The following table summarizes the key differences:

| Capability             | OpenCode                                | OpenZero                                                                                      |
| :--------------------- | :-------------------------------------- | :-------------------------------------------------------------------------------------------- |
| Memory system          | Single plain-text type, mem0 infer mode | Six typed schemas, custom extraction pipeline                                                 |
| Memory storage         | In-memory / file-based                  | Qdrant vector database with 4096-dim embeddings                                               |
| Deduplication          | None                                    | Hash-based algorithmic deduplication                                                          |
| Context management     | Parallel compaction (uncoordinated)     | Unified three-tier hierarchical compression                                                   |
| Settings storage       | JSON cache files                        | SQLite with ACID transactions                                                                 |
| Embedding support      | Default provider dimensions             | OpenRouter Qwen3-Embedding-8B at 4096 dimensions                                              |
| Memory retrieval       | Basic text matching                     | Cosine-similarity semantic search with type-aware formatting                                  |
| Backward compatibility | N/A                                     | Full -- plain-text memories from the original system are auto-detected and rendered correctly |

### Development Investment

The project was built across three intensive phases over three days:

| Phase                      | Focus                                                                         | Duration | Key Deliverables                                                      |
| :------------------------- | :---------------------------------------------------------------------------- | :------- | :-------------------------------------------------------------------- |
| **1 -- Foundation**        | mem0 integration, Qdrant setup, basic hooks, TUI settings                     | 1 day    | Working memory pipeline, configuration UI                             |
| **2 -- Optimization**      | Hierarchical compression, token tracking, rate limiting, state persistence    | 1 day    | Three-tier compression engine, per-exchange token display             |
| **3 -- Structured System** | Custom extraction pipeline, six memory schemas, legacy removal, documentation | 2 days   | Complete structured memory system, full legacy compaction eradication |

Total: approximately 3,100 new lines of application code, 23 new source files, and 15 documentation files across 13 commits.

---

## Roadmap

OpenZero is currently in production-ready alpha. The planned evolution:

**v1.1** -- Metadata-filtered search (query by memory type, time range, trigger condition). Memory importance scoring. Analytics dashboard for memory distribution and retrieval effectiveness.

**v1.2** -- Memory relationships and dependency graphs between entries. Advanced semantic summarization for compression. Plugin marketplace. Multi-user memory sharing within a team.

**v2.0** -- Federated memory across separate OpenZero instances. ML-based memory ranking trained on retrieval feedback. Real-time collaborative sessions. Enterprise features (SSO, audit logging, role-based access).

---

## Getting Started

### Prerequisites

- Bun runtime
- Docker (for Qdrant)
- An LLM provider API key (OpenRouter recommended)

### Quick Start

```bash
# Clone the repository
git clone https://github.com/openzero-ai/openzero.git

# Install dependencies
bun install

# Start Qdrant
docker run -p 6333:6333 qdrant/qdrant

# Run database migrations
bun run db:migrate

# Start in development mode
bun run dev
```

---

## Attribution and License

OpenZero is a fork of [OpenCode](https://github.com/anomalyco/opencode) by Anomaly. All original OpenCode code is used in compliance with its license terms.

**License**: MIT License
**Version**: [VERSION_PLACEHOLDER]

---

Built by developers who got tired of re-explaining things to their AI.
