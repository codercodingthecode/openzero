import { Component, createMemo, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@openzero/ui/button"
import { Icon } from "@openzero/ui/icon"
import { Input } from "@openzero/ui/input"
import { Select } from "@openzero/ui/select"
import { Switch } from "@openzero/ui/switch"
import { showToast } from "@openzero/ui/toast"
import { useLanguage } from "@/context/language"
import { useGlobalSync } from "@/context/global-sync"
import { useProviders } from "@/hooks/use-providers"

export const SettingsMemory: Component = () => {
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const providers = useProviders()

  const config = createMemo(() => globalSync.data.config.experimental?.memory || {})

  const [store, setStore] = createStore({
    saving: false,
  })

  // Get available models from connected providers
  const availableModels = createMemo(() => {
    const models: Array<{ value: string; label: string }> = []

    providers.connected().forEach((provider) => {
      Object.entries(provider.models).forEach(([modelId, model]) => {
        if (model.type === "chat") {
          models.push({
            value: `${provider.id}/${modelId}`,
            label: `${provider.name} - ${modelId}`,
          })
        }
      })
    })

    return models
  })

  const availableEmbeddingModels = createMemo(() => {
    // For now, hardcode common embedding models
    // Could be extended to detect from providers
    return [
      { value: "openai/text-embedding-3-small", label: "OpenAI - text-embedding-3-small (1536 dims)" },
      { value: "openai/text-embedding-3-large", label: "OpenAI - text-embedding-3-large (3072 dims)" },
      { value: "openai/text-embedding-ada-002", label: "OpenAI - text-embedding-ada-002 (1536 dims)" },
    ]
  })

  const updateMemoryConfig = async (updates: Record<string, any>) => {
    const current = globalSync.data.config.experimental?.memory || {}
    const updated = { ...current, ...updates }

    setStore("saving", true)

    try {
      await globalSync.updateConfig({
        experimental: {
          ...globalSync.data.config.experimental,
          memory: updated,
        },
      })

      showToast({
        variant: "success",
        icon: "circle-check",
        title: "Memory settings saved",
        description: "Your memory configuration has been updated",
      })
    } catch (error) {
      showToast({
        variant: "error",
        icon: "circle-x",
        title: "Failed to save settings",
        description: error instanceof Error ? error.message : "Unknown error",
      })
    } finally {
      setStore("saving", false)
    }
  }

  return (
    <div class="flex flex-col gap-6 p-6">
      <div class="flex flex-col gap-2">
        <h2 class="text-16-semibold">Memory System</h2>
        <p class="text-13-regular text-text-weak">Configure long-term memory to remember context across sessions</p>
      </div>

      {/* Enable/Disable */}
      <div class="flex items-center justify-between">
        <div class="flex flex-col gap-1">
          <span class="text-13-medium">Enable Memory</span>
          <span class="text-12-regular text-text-weak">
            Automatically remember important information across sessions
          </span>
        </div>
        <Switch checked={config().enabled || false} onChange={(checked) => updateMemoryConfig({ enabled: checked })} />
      </div>

      <Show when={config().enabled}>
        <div class="flex flex-col gap-6 pt-4 border-t border-border-subtle">
          {/* Memory Model */}
          <div class="flex flex-col gap-2">
            <label class="text-13-medium">Memory Model</label>
            <p class="text-12-regular text-text-weak mb-2">
              LLM used for extracting and managing memories (choose a cheap/fast model)
            </p>
            <Select
              value={config().model || ""}
              onChange={(value) => updateMemoryConfig({ model: value })}
              placeholder="Select a model..."
              options={availableModels()}
            />
            <Show when={!config().model}>
              <p class="text-12-regular text-status-error">
                <Icon name="alert-circle" class="inline w-3 h-3 mr-1" />
                Memory model is required
              </p>
            </Show>
          </div>

          {/* Embedding Model */}
          <div class="flex flex-col gap-2">
            <label class="text-13-medium">Embedding Model</label>
            <p class="text-12-regular text-text-weak mb-2">Model used for vector embeddings (semantic search)</p>
            <Select
              value={config().embedding_model || ""}
              onChange={(value) => updateMemoryConfig({ embedding_model: value })}
              placeholder="Select an embedding model..."
              options={availableEmbeddingModels()}
            />
            <Show when={!config().embedding_model}>
              <p class="text-12-regular text-status-error">
                <Icon name="alert-circle" class="inline w-3 h-3 mr-1" />
                Embedding model is required
              </p>
            </Show>
          </div>

          {/* Qdrant Settings */}
          <div class="flex flex-col gap-4 pt-4 border-t border-border-subtle">
            <h3 class="text-14-medium">Vector Database (Qdrant)</h3>

            <div class="flex items-center justify-between">
              <div class="flex flex-col gap-1">
                <span class="text-13-medium">Auto-start Qdrant</span>
                <span class="text-12-regular text-text-weak">Automatically download and start Qdrant server</span>
              </div>
              <Switch
                checked={config().qdrant?.auto_start ?? true}
                onChange={(checked) =>
                  updateMemoryConfig({
                    qdrant: { ...config().qdrant, auto_start: checked },
                  })
                }
              />
            </div>

            <Show when={!config().qdrant?.auto_start}>
              <div class="flex flex-col gap-2">
                <label class="text-13-medium">Qdrant Host</label>
                <Input
                  value={config().qdrant?.host || "localhost"}
                  onChange={(e) =>
                    updateMemoryConfig({
                      qdrant: { ...config().qdrant, host: e.currentTarget.value },
                    })
                  }
                  placeholder="localhost"
                />
              </div>

              <div class="flex flex-col gap-2">
                <label class="text-13-medium">Qdrant Port</label>
                <Input
                  type="number"
                  value={config().qdrant?.port || 6333}
                  onChange={(e) =>
                    updateMemoryConfig({
                      qdrant: { ...config().qdrant, port: parseInt(e.currentTarget.value) },
                    })
                  }
                  placeholder="6333"
                />
              </div>
            </Show>
          </div>

          {/* Recall Settings */}
          <div class="flex flex-col gap-4 pt-4 border-t border-border-subtle">
            <h3 class="text-14-medium">Memory Recall</h3>

            <div class="flex items-center justify-between">
              <div class="flex flex-col gap-1">
                <span class="text-13-medium">Enable Recall</span>
                <span class="text-12-regular text-text-weak">Inject relevant memories into conversation context</span>
              </div>
              <Switch
                checked={config().recall?.enabled ?? true}
                onChange={(checked) =>
                  updateMemoryConfig({
                    recall: { ...config().recall, enabled: checked },
                  })
                }
              />
            </div>

            <Show when={config().recall?.enabled ?? true}>
              <div class="flex flex-col gap-2">
                <label class="text-13-medium">Recall Interval</label>
                <p class="text-12-regular text-text-weak mb-2">
                  Recall memories every N turns (1 = every turn, 3 = every 3rd turn)
                </p>
                <Input
                  type="number"
                  value={config().recall?.interval || 3}
                  onChange={(e) =>
                    updateMemoryConfig({
                      recall: { ...config().recall, interval: parseInt(e.currentTarget.value) },
                    })
                  }
                  placeholder="3"
                  min={1}
                />
              </div>

              <div class="flex flex-col gap-2">
                <label class="text-13-medium">Max Results</label>
                <p class="text-12-regular text-text-weak mb-2">Maximum number of memories to recall per turn</p>
                <Input
                  type="number"
                  value={config().recall?.max_results || 5}
                  onChange={(e) =>
                    updateMemoryConfig({
                      recall: { ...config().recall, max_results: parseInt(e.currentTarget.value) },
                    })
                  }
                  placeholder="5"
                  min={1}
                  max={20}
                />
              </div>
            </Show>
          </div>

          {/* Auto-Memorize Settings */}
          <div class="flex flex-col gap-4 pt-4 border-t border-border-subtle">
            <h3 class="text-14-medium">Auto-Memorize</h3>

            <div class="flex items-center justify-between">
              <div class="flex flex-col gap-1">
                <span class="text-13-medium">Enable Auto-Memorize</span>
                <span class="text-12-regular text-text-weak">
                  Automatically extract and save memories after conversations
                </span>
              </div>
              <Switch
                checked={config().auto_memorize?.enabled ?? true}
                onChange={(checked) =>
                  updateMemoryConfig({
                    auto_memorize: { ...config().auto_memorize, enabled: checked },
                  })
                }
              />
            </div>

            <Show when={config().auto_memorize?.enabled ?? true}>
              <div class="flex flex-col gap-2">
                <label class="text-13-medium">Idle Timeout (seconds)</label>
                <p class="text-12-regular text-text-weak mb-2">
                  Wait this many seconds after conversation ends before memorizing
                </p>
                <Input
                  type="number"
                  value={config().auto_memorize?.idle_timeout || 60}
                  onChange={(e) =>
                    updateMemoryConfig({
                      auto_memorize: {
                        ...config().auto_memorize,
                        idle_timeout: parseInt(e.currentTarget.value),
                      },
                    })
                  }
                  placeholder="60"
                  min={5}
                />
              </div>
            </Show>
          </div>

          {/* Status Info */}
          <div class="flex flex-col gap-2 p-4 bg-surface-secondary rounded-lg">
            <div class="flex items-start gap-2">
              <Icon name="info" class="w-4 h-4 mt-0.5 text-text-weak" />
              <div class="flex flex-col gap-1 text-12-regular text-text-weak">
                <p>
                  Memory data is stored locally in <code>~/.openzero/memory/</code>
                </p>
                <p>Qdrant server runs on localhost:{config().qdrant?.port || 6333}</p>
                <Show when={!config().model || !config().embedding_model}>
                  <p class="text-status-warning">
                    ⚠️ Both memory model and embedding model must be configured for the memory system to work
                  </p>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
