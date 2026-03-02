import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"

/**
 * Global settings stored in SQLite (not JSON files)
 * Single-row table for global configuration
 */
export const GlobalSettingsTable = sqliteTable("global_settings", {
  id: text()
    .primaryKey()
    .$defaultFn(() => "singleton"),
  memory_model: text(), // Memory Model for compression operations (e.g., 'github-copilot/gpt-5-mini')
  ...Timestamps,
})
