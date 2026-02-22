import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import z from "zod"
import { Installation } from "../installation"
import { Flag } from "../flag/flag"
import { Filesystem } from "../util/filesystem"
import { Database, eq, sql } from "../storage/db"
import { ProviderModelTable, ProviderTable } from "./registry.sql"
import { unlink } from "fs/promises"

// Try to import bundled snapshot (generated at build time)
// Falls back to undefined in dev mode when snapshot doesn't exist
/* @ts-ignore */

export namespace ModelsDev {
  const log = Log.create({ service: "models.dev" })
  const filepath = path.join(Global.Path.cache, "models.json")

  export const Model = z.object({
    id: z.string(),
    name: z.string(),
    family: z.string().optional(),
    release_date: z.string(),
    attachment: z.boolean(),
    reasoning: z.boolean(),
    temperature: z.boolean(),
    tool_call: z.boolean(),
    interleaved: z
      .union([
        z.literal(true),
        z
          .object({
            field: z.enum(["reasoning_content", "reasoning_details"]),
          })
          .strict(),
      ])
      .optional(),
    cost: z
      .object({
        input: z.number(),
        output: z.number(),
        cache_read: z.number().optional(),
        cache_write: z.number().optional(),
        context_over_200k: z
          .object({
            input: z.number(),
            output: z.number(),
            cache_read: z.number().optional(),
            cache_write: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
    limit: z.object({
      context: z.number(),
      input: z.number().optional(),
      output: z.number(),
    }),
    modalities: z
      .object({
        input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
        output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
      })
      .optional(),
    experimental: z.boolean().optional(),
    status: z.enum(["alpha", "beta", "deprecated"]).optional(),
    options: z.record(z.string(), z.any()),
    headers: z.record(z.string(), z.string()).optional(),
    provider: z.object({ npm: z.string().optional(), api: z.string().optional() }).optional(),
    variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
  })
  export type Model = z.infer<typeof Model>

  export const Provider = z.object({
    api: z.string().optional(),
    name: z.string(),
    env: z.array(z.string()),
    id: z.string(),
    npm: z.string().optional(),
    models: z.record(z.string(), Model),
  })

  export type Provider = z.infer<typeof Provider>

  function url() {
    return Flag.OPENZERO_MODELS_URL || "https://models.dev"
  }

  async function readLegacyModels(): Promise<Record<string, Provider> | undefined> {
    const legacyPath = Flag.OPENZERO_MODELS_PATH ?? filepath
    const result = await Filesystem.readJson<Record<string, Provider>>(legacyPath).catch(() => undefined)
    if (result) return result
    // @ts-ignore
    const snapshot = await import("./models-snapshot")
      .then((m) => m.snapshot as unknown as Record<string, Provider>)
      .catch(() => undefined)
    if (snapshot) return snapshot
    if (Flag.OPENZERO_DISABLE_MODELS_FETCH) return {}
    const json = await fetch(`${url()}/api.json`).then((x) => x.text())
    return JSON.parse(json)
  }

  async function ensureSeeded() {
    const client = Database.Client() as unknown as {
      $client: {
        query: (sql: string) => { all: () => any[] }
        run: (sql: string) => void
      }
    }
    const tables = client.$client
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('provider', 'provider_model')")
      .all() as { name: string }[]
    const existing = new Set(tables.map((row) => row.name))
    if (!existing.has("provider") || !existing.has("provider_model")) {
      client.$client.run(`
        CREATE TABLE IF NOT EXISTS "provider" (
          "id" text PRIMARY KEY NOT NULL,
          "name" text NOT NULL,
          "api" text,
          "npm" text,
          "env" text,
          "auth" text,
          "api_key" text,
          "enabled" integer DEFAULT 1 NOT NULL,
          "last_updated" integer NOT NULL,
          "data" text
        );
      `)
      client.$client.run(`
        CREATE TABLE IF NOT EXISTS "provider_model" (
          "id" text PRIMARY KEY NOT NULL,
          "provider_id" text NOT NULL,
          "model_id" text NOT NULL,
          "name" text NOT NULL,
          "family" text,
          "modalities" text,
          "cost" text,
          "limits" text,
          "dimension" integer,
          "status" text DEFAULT 'active',
          "data" text,
          "last_updated" integer NOT NULL,
          FOREIGN KEY ("provider_id") REFERENCES "provider"("id") ON UPDATE no action ON DELETE cascade
        );
      `)
      client.$client.run(
        'CREATE INDEX IF NOT EXISTS "provider_model_provider_idx" ON "provider_model" ("provider_id");',
      )
      client.$client.run('CREATE INDEX IF NOT EXISTS "provider_model_modality_idx" ON "provider_model" ("modalities");')
    }

    const counts = Database.use((db) => {
      const providers =
        db
          .select({ count: sql<number>`count(*)` })
          .from(ProviderTable)
          .get()?.count ?? 0
      const models =
        db
          .select({ count: sql<number>`count(*)` })
          .from(ProviderModelTable)
          .get()?.count ?? 0
      return { providers, models }
    })

    if (counts.models > 0) return

    const legacy = await readLegacyModels()
    if (!legacy || Object.keys(legacy).length === 0) return
    await upsertModels(legacy, 0)

    if (!Flag.OPENZERO_MODELS_PATH) {
      await unlink(filepath).catch(() => {})
    }
  }

  function modelRow(providerID: string, model: Model, updatedAt: number) {
    const modelID = model.id ?? ""
    const fullID = `${providerID}/${modelID}`
    return {
      id: fullID,
      provider_id: providerID,
      model_id: modelID,
      name: model.name ?? modelID,
      family: model.family ?? null,
      modalities: model.modalities ?? null,
      cost: model.cost ?? null,
      limits: model.limit ?? null,
      dimension: (model as any).dimension ?? null,
      status: model.status ?? "active",
      data: model as unknown as Record<string, any>,
      last_updated: updatedAt,
    }
  }

  function providerRow(provider: Provider, updatedAt: number) {
    return {
      id: provider.id,
      name: provider.name,
      api: provider.api ?? null,
      npm: provider.npm ?? null,
      env: Array.from(provider.env ?? []),
      enabled: true,
      last_updated: updatedAt,
      data: provider as unknown as Record<string, any>,
    }
  }

  async function upsertModels(data: Record<string, Provider>, updatedAt: number) {
    const providers = Object.values(data).map((provider) => providerRow(provider, updatedAt))
    const models = Object.entries(data).flatMap(([providerID, provider]) =>
      Object.values(provider.models ?? {}).map((model) => modelRow(providerID, model, updatedAt)),
    )

    if (providers.length === 0) return

    const providerUpdated = updatedAt === 0 ? sql`max(${ProviderTable.last_updated}, ${updatedAt})` : updatedAt
    const modelUpdated = updatedAt === 0 ? sql`max(${ProviderModelTable.last_updated}, ${updatedAt})` : updatedAt

    Database.transaction((db) => {
      db.insert(ProviderTable)
        .values(providers)
        .onConflictDoUpdate({
          target: ProviderTable.id,
          set: {
            name: sql`excluded.name`,
            api: sql`excluded.api`,
            npm: sql`excluded.npm`,
            env: sql`excluded.env`,
            data: sql`excluded.data`,
            last_updated: providerUpdated,
          },
        })
        .run()

      if (models.length > 0) {
        db.insert(ProviderModelTable)
          .values(models)
          .onConflictDoUpdate({
            target: ProviderModelTable.id,
            set: {
              provider_id: sql`excluded.provider_id`,
              model_id: sql`excluded.model_id`,
              name: sql`excluded.name`,
              family: sql`excluded.family`,
              modalities: sql`excluded.modalities`,
              cost: sql`excluded.cost`,
              limits: sql`excluded.limits`,
              dimension: sql`excluded.dimension`,
              status: sql`excluded.status`,
              data: sql`excluded.data`,
              last_updated: modelUpdated,
            },
          })
          .run()
      }
    })
  }

  function modelIdFromRow(id: string, providerID: string) {
    const prefix = `${providerID}/`
    if (id.startsWith(prefix)) return id.slice(prefix.length)
    return id
  }

  export async function get() {
    await ensureSeeded()

    const providers = Database.use((db) => db.select().from(ProviderTable).where(eq(ProviderTable.enabled, true)).all())
    const models = Database.use((db) => db.select().from(ProviderModelTable).all())

    const grouped = new Map<string, typeof models>()
    for (const model of models) {
      const existing = grouped.get(model.provider_id)
      if (existing) {
        existing.push(model)
        continue
      }
      grouped.set(model.provider_id, [model])
    }

    const result: Record<string, Provider> = {}
    for (const provider of providers) {
      const providerData = (provider.data ?? {}) as Provider
      const modelRows = grouped.get(provider.id) ?? []
      if (modelRows.length === 0) continue
      const models: Record<string, Model> = {}
      for (const row of modelRows) {
        const data = (row.data ?? {}) as Partial<Model>
        const id = row.model_id || modelIdFromRow(row.id, row.provider_id)
        const model: Model = {
          ...(data as Model),
          id,
          name: row.name ?? data.name ?? id,
          family: row.family ?? data.family,
          cost: (row.cost ?? data.cost) as Model["cost"],
          limit: (row.limits ?? data.limit) as Model["limit"],
          modalities: (row.modalities ?? data.modalities) as Model["modalities"],
          status: (row.status ?? data.status) as Model["status"],
        }
        models[id] = model
      }

      result[provider.id] = {
        ...providerData,
        id: provider.id,
        name: provider.name,
        api: provider.api ?? providerData.api,
        npm: provider.npm ?? providerData.npm,
        env: Array.from(provider.env ?? providerData.env ?? []),
        models,
      }
    }

    return result
  }

  export async function refresh() {
    const result = await fetch(`${url()}/api.json`, {
      headers: {
        "User-Agent": Installation.USER_AGENT,
      },
      signal: AbortSignal.timeout(10 * 1000),
    }).catch((e) => {
      log.error("Failed to fetch models.dev", {
        error: e,
      })
    })
    if (result && result.ok) {
      const fetched = await result.text()
      const fetchedData = JSON.parse(fetched)

      // Merge custom OpenRouter embeddings that aren't in models.dev upstream
      if (fetchedData.openrouter && !fetchedData.openrouter.models["qwen/qwen3-embedding-8b"]) {
        fetchedData.openrouter.models["qwen/qwen3-embedding-8b"] = {
          id: "qwen/qwen3-embedding-8b",
          name: "Qwen3 Embedding 8B",
          family: "text-embedding",
          attachment: false,
          reasoning: false,
          tool_call: false,
          structured_output: false,
          temperature: false,
          knowledge: "2025-10",
          release_date: "2026-01-10",
          last_updated: "2026-02-21",
          modalities: {
            input: ["text"],
            output: ["text"],
          },
          open_weights: true,
          cost: {
            input: 0.01,
            output: 0,
          },
          limit: {
            context: 32768,
            input: 32768,
            output: 0,
          },
        }
      }

      await upsertModels(fetchedData, Date.now())
    }
  }
}

if (!Flag.OPENZERO_DISABLE_MODELS_FETCH && !process.argv.includes("--get-yargs-completions")) {
  ModelsDev.refresh()
  setInterval(
    async () => {
      await ModelsDev.refresh()
    },
    60 * 1000 * 60,
  ).unref()
}
