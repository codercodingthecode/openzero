import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"

export const ProviderTable = sqliteTable("provider", {
  id: text().primaryKey(),
  name: text().notNull(),
  api: text(),
  npm: text(),
  env: text({ mode: "json" }).$type<string[]>(),
  auth: text({ mode: "json" }).$type<Record<string, any>>(),
  api_key: text(),
  enabled: integer({ mode: "boolean" })
    .notNull()
    .$default(() => true),
  last_updated: integer().notNull(),
  data: text({ mode: "json" }).$type<Record<string, any>>(),
})

export const ProviderModelTable = sqliteTable(
  "provider_model",
  {
    id: text().primaryKey(),
    provider_id: text()
      .notNull()
      .references(() => ProviderTable.id, { onDelete: "cascade" }),
    model_id: text().notNull(),
    name: text().notNull(),
    family: text(),
    modalities: text({ mode: "json" }).$type<Record<string, any>>(),
    cost: text({ mode: "json" }).$type<Record<string, any>>(),
    limits: text({ mode: "json" }).$type<Record<string, any>>(),
    dimension: integer(),
    status: text().$default(() => "active"),
    data: text({ mode: "json" }).$type<Record<string, any>>(),
    last_updated: integer().notNull(),
  },
  (table) => [
    index("provider_model_provider_idx").on(table.provider_id),
    index("provider_model_modality_idx").on(table.modalities),
  ],
)
