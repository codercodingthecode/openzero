import path from "path"
import { Global } from "../global"
import z from "zod"
import { Filesystem } from "../util/filesystem"
import { Database, eq, isNotNull } from "../storage/db"
import { ProviderTable } from "../provider/registry.sql"
import { unlink } from "fs/promises"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

export namespace Auth {
  export const Oauth = z
    .object({
      type: z.literal("oauth"),
      refresh: z.string(),
      access: z.string(),
      expires: z.number(),
      accountId: z.string().optional(),
      enterpriseUrl: z.string().optional(),
    })
    .meta({ ref: "OAuth" })

  export const Api = z
    .object({
      type: z.literal("api"),
      key: z.string(),
    })
    .meta({ ref: "ApiAuth" })

  export const WellKnown = z
    .object({
      type: z.literal("wellknown"),
      key: z.string(),
      token: z.string(),
    })
    .meta({ ref: "WellKnownAuth" })

  export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown]).meta({ ref: "Auth" })
  export type Info = z.infer<typeof Info>

  const filepath = path.join(Global.Path.data, "auth.json")

  async function migrateLegacyAuth() {
    const legacy = await Filesystem.readJson<Record<string, unknown>>(filepath).catch(() => undefined)
    if (!legacy) return
    const entries = Object.entries(legacy).flatMap(([key, value]) => {
      const parsed = Info.safeParse(value)
      if (!parsed.success) return []
      return [{ id: key, info: parsed.data }]
    })

    if (entries.length === 0) return

    const updatedAt = Date.now()
    Database.transaction((db) => {
      for (const entry of entries) {
        const apiKey = entry.info.type === "api" ? entry.info.key : null
        db.insert(ProviderTable)
          .values({
            id: entry.id,
            name: entry.id,
            env: [],
            enabled: true,
            last_updated: updatedAt,
            auth: entry.info as unknown as Record<string, any>,
            api_key: apiKey,
          })
          .onConflictDoUpdate({
            target: ProviderTable.id,
            set: {
              auth: entry.info as unknown as Record<string, any>,
              api_key: apiKey,
              last_updated: updatedAt,
            },
          })
          .run()
      }
    })

    await unlink(filepath).catch(() => {})
  }

  export async function get(providerID: string) {
    const auth = await all()
    return auth[providerID]
  }

  export async function all(): Promise<Record<string, Info>> {
    await migrateLegacyAuth()
    const rows = Database.use((db) => db.select().from(ProviderTable).where(isNotNull(ProviderTable.auth)).all())
    return rows.reduce(
      (acc, row) => {
        const parsed = Info.safeParse(row.auth)
        if (!parsed.success) return acc
        acc[row.id] = parsed.data
        return acc
      },
      {} as Record<string, Info>,
    )
  }

  export async function set(key: string, info: Info) {
    const updatedAt = Date.now()
    const apiKey = info.type === "api" ? info.key : null
    Database.use((db) => {
      db.insert(ProviderTable)
        .values({
          id: key,
          name: key,
          env: [],
          enabled: true,
          last_updated: updatedAt,
          auth: info as unknown as Record<string, any>,
          api_key: apiKey,
        })
        .onConflictDoUpdate({
          target: ProviderTable.id,
          set: {
            auth: info as unknown as Record<string, any>,
            api_key: apiKey,
            last_updated: updatedAt,
          },
        })
        .run()
    })
  }

  export async function remove(key: string) {
    Database.use((db) => {
      db.update(ProviderTable)
        .set({ auth: null, api_key: null, last_updated: Date.now() })
        .where(eq(ProviderTable.id, key))
        .run()
    })
  }
}
