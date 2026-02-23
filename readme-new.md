<p align="center">
  <h1>OpenZero</h1>
</p>
<p align="center">The open source AI coding agent with perfect memory.</p>
<p align="center">
  [![Version](https://img.shields.io/badge/version-%5BVERSION_PLACEHOLDER%5D-blue.svg)]()
  [![License](https://img.shields.io/badge/license-%5BLICENSE_PLACEHOLDER%5D-green.svg)]()
</p>

<p align="center">
  <a href="#">English</a> |
  <a href="#">简体中文</a> |
  <a href="#">日本語</a> |
  <a href="#">Español</a> |
  <a href="#">Français</a>
</p>

---

## 🌟 Executive Summary

**OpenZero** is an AI-powered development environment designed to solve the two most critical limitations of modern AI coding assistants: **context amnesia** and **token limit exhaustion**.

Forked from the robust foundation of the OpenCode project, OpenZero introduces a sophisticated, schema-driven **Structured Memory System** and an intelligent **Hierarchical Context Compression** engine. Together, these systems enable AI assistants to maintain deep, multi-session context across complex software projects while strictly managing resource constraints and maintaining peak inference performance.

---

## 🧠 Major Innovation 1: Structured Memory System

Traditional AI coding assistants process conversations in a linear, flat manner. As a project grows, the assistant blindly truncates older messages, permanently losing crucial architectural decisions, bug fixes, and user preferences.

OpenZero fundamentally reimagines this lifecycle. Instead of treating history as a disposable text stream, OpenZero operates a continuous background pipeline that extracts, categorizes, and vectorizes project knowledge into long-term storage.

### The Six Memory Schemas

OpenZero categorizes all extracted knowledge into six distinct, strictly typed schemas. This allows the retrieval engine to not just find relevant text, but to understand the _category_ of the knowledge being injected into the prompt.

| Memory Type      | Purpose                             | Key Metadata Tracked                           |
| :--------------- | :---------------------------------- | :--------------------------------------------- |
| **Workflow**     | Repeatable processes and operations | Commands, triggers, dependencies               |
| **Bug Fix**      | Post-mortems for solved problems    | Symptoms, root causes, solutions, prevention   |
| **Architecture** | High-level design decisions         | Decisions, rationales, alternatives, tradeoffs |
| **Preference**   | User coding styles and tool choices | Categories, concrete examples                  |
| **Config**       | Environment settings and variables  | Settings, values, locations, business purpose  |
| **Fact**         | General project information         | Details, semantic keywords                     |

### Architecture & Data Flow

During active development, a background hook monitors the conversation. It utilizes a custom extraction prompt to evaluate if the exchange contains valuable long-term knowledge, parses it, and embeds it into a high-dimensional vector space (supporting models up to 4096 dimensions).

```text
┌─────────────────────────────────────────────────────────────────┐
│                    EXTRACTION & STORAGE                          │
└─────────────────────────────────────────────────────────────────┘

  [ Conversation ]
         │
         ▼
  [ Extraction Pipeline ]
   ├─ LLM with structured evaluation prompts
   ├─ Semantic parsing & validation against the 6 schemas
   └─ Metadata tagging (timestamp, session hash)
         │
         ▼
  [ Integration Layer ]
   ├─ 4096-dimension embedding generation
   └─ Algorithmic deduplication (ADD/UPDATE/DELETE)
         │
         ▼
  [ Qdrant Vector Store ]
   └─ Persistent, highly-indexed storage
```

On subsequent interactions, the retrieval engine performs a semantic search against this vector space, pulling highly relevant, structured historical context and seamlessly injecting it into the active prompt's system instructions before the LLM processes the user's message.

---

## 🗜️ Major Innovation 2: Hierarchical Context Compression

To complement the long-term vector memory, OpenZero features a highly aggressive, intelligent compression algorithm for the active session history. This ensures the language model never exceeds its maximum token threshold.

### The Three-Tier Architecture

Inspired by advanced agent architectures, the active session history is divided into three distinct tiers, each allocated a strict percentage of the total historical token budget:

- **Current Tier (50% of budget)**: Holds the most recent, entirely uncompressed messages. This provides the AI with perfect, high-fidelity recall of the immediate conversation.
- **Topics Tier (30% of budget)**: Contains summarized blocks of older, related messages. When the Current Tier overflows, its oldest messages are bundled, summarized into a cohesive "topic," and moved here.
- **Bulks Tier (20% of budget)**: Represents ancient project history. When the Topics Tier overflows, older topics are merged together and heavily compressed into dense, ultra-compact summary blocks.

### The Asynchronous Compression Algorithm

The compression engine operates completely asynchronously to ensure zero latency impact on the user experience.

1.  **Trigger Phase**: After every single assistant response, the background engine evaluates the total token count of the current session history.
2.  **Threshold Check**: The system checks if the total history tokens exceed a strict **70% threshold** of the model's absolute context limit. If it remains under 70%, no action is taken.
3.  **Prioritization Loop**: If the threshold is breached, the algorithm calculates exactly which of the three tiers is most severely exceeding its allocated budget ratio.
4.  **Targeted Compression**: The engine targets the most "over-budget" tier first, applying targeted LLM summarization to push its oldest contents down the hierarchy.
5.  **Iterative Stabilization**: This compression loop runs iteratively until the entire session history successfully fits within the established architectural ratios.

_Note: As part of the OpenZero architectural overhaul, all legacy, unoptimized parallel compaction systems inherited from the baseline project were completely eradicated. The environment now relies exclusively on this unified, AI-driven hierarchical compression pipeline._

---

## 🏗️ System Architecture

OpenZero operates on a robust, multi-layered architecture designed for resilience, horizontal scalability, and speed.

```text
┌─────────────────────────────────────────────────────────────────┐
│                        User Interface                            │
│                     (TUI / Web App / API)                       │
└─────────────┬───────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Session Manager                              │
│  - Message routing & context building                           │
│  - Active history management                                    │
│  - Asynchronous hook orchestration                              │
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

### Performance Characteristics

The system is highly optimized to ensure memory operations do not block the critical chat loop.

| Subsystem       | Operation            | Target Latency | Throughput | Notes              |
| :-------------- | :------------------- | :------------- | :--------- | :----------------- |
| **Memory**      | Embedding Generation | 100-300ms      | 3-10 req/s | Model-dependent    |
| **Memory**      | Vector Search        | <200ms         | >5 req/s   | Handled via Qdrant |
| **Memory**      | Context Formatting   | <10ms          | >100 req/s | Pure computation   |
| **Compression** | Token Counting       | <50ms          | >20 req/s  | Cached tokenizer   |
| **Compression** | State Save           | <50ms          | >20 req/s  | SQLite write       |

---

## 📈 Development History & Project Evolution

OpenZero represents a massive engineering sprint, transforming the capable OpenCode baseline into a highly specialized, context-aware agent environment. Thousands of lines of code were introduced across three distinct evolutionary phases:

1.  **Phase 1 (Foundation)**: Integration of the underlying orchestration layer, establishment of the dual SQLite/Vector storage paradigm, and initial UI configuration bindings.
2.  **Phase 2 (Optimization)**: Implementation of the hierarchical compression algorithms, strict token budget management, and advanced database schema migrations to support complex state tracking.
3.  **Phase 3 (Structured System)**: The complete rollout of the schema-driven memory pipeline, and the aggressive deprecation and removal of all legacy compaction mechanics.

---

## 🚀 Roadmap & Future Vision

OpenZero is currently in a production-ready alpha state. As an independent open-source project, our immediate roadmap focuses on expanding its capabilities:

- **Cross-Project Memory Sharing**: Allowing the vector database to map and share architectural decisions and developer preferences across entirely different codebases.
- **Framework-Specific Schemas**: Introducing dedicated memory types for highly opinionated ecosystems (e.g., React component lifecycles, Rust memory safety patterns).
- **Granular UI Controls**: Exposing the internal compression ratios and memory extraction thresholds directly to the user interface for ultimate environmental tuning.

---

## 🤝 Open Source & Community

OpenZero is built by developers, for developers. Detailed contribution guidelines, architectural diagrams, security policies, and technical implementation guides are included in the repository.

Join us in building an AI development environment that truly remembers.
