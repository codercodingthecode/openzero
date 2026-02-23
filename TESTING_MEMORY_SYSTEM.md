# Testing OpenZero Memory System

## Quick Start (Development Mode)

### 1. Configure Memory System

Edit `~/.config/openzero/openzero.jsonc` and add:

```jsonc
{
  "$schema": "https://openzero.local/config.json",
  "experimental": {
    "memory": {
      "enabled": true,
      "model": "openai/gpt-4o-mini",
      "embedding_model": "openai/text-embedding-3-small",
    },
  },
}
```

**Note**: All other settings (Qdrant, recall, auto-memorize) have good defaults and don't need to be configured.

### 2. Set up OpenAI API Key

**Option A: Environment Variable** (Simplest)

```bash
export OPENAI_API_KEY="sk-..."
```

**Option B: Provider Configuration** (Better)
Add OpenAI as a provider in your config:

```jsonc
{
  "provider": {
    "openai": {
      "apiKey": "sk-...",
    },
  },
  "experimental": {
    "memory": {
      "enabled": true,
      "model": "openai/gpt-4o-mini",
      "embedding_model": "openai/text-embedding-3-small",
    },
  },
}
```

### 3. Start OpenZero in Dev Mode

```bash
cd packages/openzero
bun run dev
```

### 4. What Will Happen

**On First Start:**

1. ✅ Qdrant binary downloads (~30MB) to `~/.openzero/bin/qdrant`
2. ✅ Qdrant starts on `localhost:6333`
3. ✅ Mem0 initializes with GPT-4o-mini
4. ✅ Memory system ready!

**Logs to watch for:**

```
[memory-plugin] initializing memory system
[qdrant] downloading qdrant binary
[qdrant] qdrant server started successfully
[mem0] mem0 initialized successfully
```

## Testing the Memory System

### Test 1: Basic Conversation with Auto-Memorization

1. Start a coding conversation:

   ```
   User: I prefer using functional programming style over OOP
   User: This project uses Drizzle ORM with SQLite
   User: Authentication is handled by @openauthjs/openauth
   ```

2. Wait 60 seconds (auto-memorize idle timeout)

3. Check logs for:

   ```
   [memory-memorize] starting memorization
   [memory-memorize] memorization complete
   ```

4. Start a NEW session and ask:

   ```
   User: What do you know about my coding preferences?
   ```

5. The AI should recall your preferences!

### Test 2: Manual Memory Tools

You can explicitly tell the AI to save/search memories:

```
User: Please save to memory: I use Bun as my package manager

User: Search memory for information about my tech stack

User: Delete memory [ID from search results]
```

### Test 3: Recall Behavior

**Recall happens:**

- On the 1st turn of every session (always)
- Every 3rd turn after that (configurable)

**Check logs:**

```
[memory-recall] performing recall
[memory-recall] recalled memories (count: 3)
```

## Advanced Configuration

### Custom Models

Use any OpenAI-compatible model:

```jsonc
{
  "experimental": {
    "memory": {
      "enabled": true,
      "model": "openai/gpt-4o-mini", // Memory extraction model (cheap!)
      "embedding_model": "openai/text-embedding-3-small", // Vector embeddings
    },
  },
}
```

### Recall Settings

```jsonc
{
  "experimental": {
    "memory": {
      "recall": {
        "enabled": true,
        "interval": 3, // Recall every 3rd turn
        "max_results": 5, // Max memories to inject
      },
    },
  },
}
```

### Auto-Memorize Settings

```jsonc
{
  "experimental": {
    "memory": {
      "auto_memorize": {
        "enabled": true,
        "idle_timeout": 60, // Seconds to wait before memorizing
      },
    },
  },
}
```

### Qdrant Settings

```jsonc
{
  "experimental": {
    "memory": {
      "qdrant": {
        "auto_start": true, // Auto-download and start Qdrant
        "host": "localhost",
        "port": 6333,
      },
    },
  },
}
```

## Troubleshooting

### "No API key found for memory provider"

**Fix**: Set `OPENAI_API_KEY` environment variable or configure OpenAI provider in config

### "memory.model not configured"

**Fix**: Add `experimental.memory.model` to your config file

### "Qdrant failed to start"

**Check**:

- Port 6333 is not in use: `lsof -i :6333`
- Qdrant binary downloaded: `ls ~/.openzero/bin/qdrant`
- Qdrant logs: Check console output

### Memory not recalling

**Check**:

- Wait for first turn (recall always happens on turn 1)
- Check logs for `[memory-recall]` messages
- Verify memories exist: Look for Qdrant data in `~/.openzero/memory/qdrant-data/`

## Data Locations

- **Qdrant binary**: `~/.openzero/bin/qdrant`
- **Qdrant data**: `~/.openzero/memory/qdrant-data/`
- **Qdrant config**: `~/.openzero/memory/qdrant-config.yaml`
- **OpenZero config**: `~/.config/openzero/openzero.jsonc`

## Clean Slate

To reset everything:

```bash
# Stop Qdrant
pkill qdrant

# Remove all memory data
rm -rf ~/.openzero/memory/

# Remove Qdrant binary
rm ~/.openzero/bin/qdrant

# Restart OpenZero - it will re-download and start fresh
```

## UI Settings (Future)

Currently, memory settings must be configured in the config file. A UI settings panel is planned for a future release.

For now, just edit `~/.config/openzero/openzero.jsonc` manually.

## Questions?

The memory system is self-contained and shouldn't interfere with normal OpenZero operation. If it fails to initialize, OpenZero will continue working without memory features.

Check the logs for detailed error messages from:

- `[memory-plugin]` - Overall plugin status
- `[qdrant]` - Qdrant lifecycle
- `[mem0]` - Mem0 operations
- `[memory-recall]` - Recall system
- `[memory-memorize]` - Auto-memorization
- `[memory-tools]` - Manual tools
