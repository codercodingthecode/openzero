import { sqliteTable, text } from "drizzle-orm/sqlite-core"

/**
 * Global settings stored in SQLite (not JSON files)
 * Key-value table for global configuration
 */
export const GlobalSettingsTable = sqliteTable("global_settings", {
  key: text().primaryKey().notNull(),
  value: text().notNull(),
})
