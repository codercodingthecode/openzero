import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { createMemo } from "solid-js"
import { pipe, flatMap, entries, filter, map, sortBy } from "remeda"

export function DialogSettings() {
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()

  const memoryConfig = () => (sync.data.config.experimental as any)?.memory

  const updateMemoryConfig = async (updates: any) => {
    const current = memoryConfig() || {}
    // Only include valid schema fields - no defaults, user must set models explicitly
    const config: any = {
      enabled: updates.enabled !== undefined ? updates.enabled : current.enabled,
      max_results: updates.max_results !== undefined ? updates.max_results : current.max_results,
    }

    // Only include model/embedding if they exist
    if (updates.model || current.model) {
      config.model = updates.model || current.model
    }
    if (updates.embedding_model || current.embedding_model) {
      config.embedding_model = updates.embedding_model || current.embedding_model
    }

    // Always include qdrant config
    config.qdrant = {
      host: current.qdrant?.host || "localhost",
      port: current.qdrant?.port || 6333,
      auto_start: current.qdrant?.auto_start ?? true,
    }

    await sdk.client.global.config.update({
      config: {
        experimental: {
          ...sync.data.config.experimental,
          memory: config,
        } as any,
      },
    })
    await sync.bootstrap()
  }

  const toggleMemory = async () => {
    await updateMemoryConfig({ enabled: !memoryConfig()?.enabled })
    dialog.replace(() => <DialogSettings />)
  }

  const selectModel = () => {
    // Build model list from actual provider data - same as DialogModel
    const modelOptions = pipe(
      sync.data.provider,
      sortBy(
        (provider) => provider.id !== "opencode",
        (provider) => provider.name,
      ),
      flatMap((provider) =>
        pipe(
          provider.models,
          entries(),
          filter(([_, info]) => info.status !== "deprecated"),
          map(([modelID, info]) => ({
            value: `${provider.id}/${modelID}`,
            title: info.name ?? modelID,
            category: provider.name,
            footer: info.cost?.input === 0 && provider.id === "opencode" ? "Free" : undefined,
            onSelect: async () => {
              await updateMemoryConfig({ model: `${provider.id}/${modelID}` })
              dialog.replace(() => <DialogSettings />)
            },
          })),
          sortBy(
            (x) => x.footer !== "Free",
            (x) => x.title,
          ),
        ),
      ),
    )

    dialog.replace(() => (
      <DialogSelect
        title="Select Memory Model"
        placeholder="Search models..."
        options={modelOptions}
        current={memoryConfig()?.model}
      />
    ))
  }

  const selectEmbeddingModel = () => {
    // Build embedding model list from actual provider data
    const embeddingOptions = pipe(
      sync.data.provider,
      flatMap((provider) =>
        pipe(
          provider.models,
          entries(),
          filter(([modelID, info]) => {
            // Filter for embedding models
            const name = (info.name ?? modelID).toLowerCase()
            return name.includes("embedding") || name.includes("embed")
          }),
          map(([modelID, info]) => ({
            value: `${provider.id}/${modelID}`,
            title: info.name ?? modelID,
            category: provider.name,
            onSelect: async () => {
              await updateMemoryConfig({ embedding_model: `${provider.id}/${modelID}` })
              dialog.replace(() => <DialogSettings />)
            },
          })),
          sortBy((x) => x.title),
        ),
      ),
    )

    dialog.replace(() => (
      <DialogSelect
        title="Select Embedding Model"
        placeholder="Search embedding models..."
        options={embeddingOptions}
        current={memoryConfig()?.embedding_model}
      />
    ))
  }

  const editMaxResults = async () => {
    const value = await DialogPrompt.show(dialog, "Max Search Results", {
      placeholder: "Maximum memories to retrieve per search (e.g., 5)",
      value: String(memoryConfig()?.max_results || 5),
    })
    if (value !== null) {
      const maxResults = parseInt(value) || 5
      await updateMemoryConfig({ max_results: maxResults })
      dialog.replace(() => <DialogSettings />)
    }
  }

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const enabled = memoryConfig()?.enabled

    const baseOptions: DialogSelectOption<string>[] = [
      {
        title: enabled ? "Disable Memory System" : "Enable Memory System",
        value: "toggle",
        description: enabled ? "Turn off long-term memory" : "Turn on long-term memory",
        category: "Memory System",
        onSelect: toggleMemory,
      },
    ]

    if (!enabled) return baseOptions

    return [
      ...baseOptions,
      {
        title: "Memory Model",
        value: "model",
        description: memoryConfig()?.model || "openai/gpt-4o-mini",
        category: "Configuration",
        onSelect: selectModel,
      },
      {
        title: "Embedding Model",
        value: "embedding",
        description: memoryConfig()?.embedding_model || "openai/text-embedding-3-small",
        category: "Configuration",
        onSelect: selectEmbeddingModel,
      },
      {
        title: "Max Search Results",
        value: "max_results",
        description: `${memoryConfig()?.max_results || 5} memories per search`,
        category: "Configuration",
        onSelect: editMaxResults,
      },
      {
        title: "Qdrant Vector Store",
        value: "qdrant",
        description: `${memoryConfig()?.qdrant?.host || "localhost"}:${memoryConfig()?.qdrant?.port || 6333} (auto-start)`,
        category: "Configuration",
        disabled: true,
      },
    ]
  })

  return <DialogSelect title="Memory Settings" placeholder="Search settings..." options={options()} flat />
}
