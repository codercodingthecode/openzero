import { Database } from "../storage/db"
import { GlobalSettingsTable } from "./global.sql"
import { eq } from "drizzle-orm"

/**
 * Global settings stored in SQLite (not JSON files)
 * Key-value storage for global configuration
 */
export namespace GlobalSettings {
  const MEMORY_MODEL_KEY = "experimental_memory_model"

  /**
   * Get the memory model setting
   * @returns Memory model string (e.g., 'github-copilot/gpt-5-mini') or null if not set
   */
  export function getMemoryModel(): string | null {
    return Database.use((db) => {
      const row = db.select().from(GlobalSettingsTable).where(eq(GlobalSettingsTable.key, MEMORY_MODEL_KEY)).get()
      return row?.value ?? null
    })
  }

  /**
   * Set the memory model setting
   * @param model Memory model string (e.g., 'github-copilot/gpt-5-mini')
   */
  export function setMemoryModel(model: string): void {
    Database.use((db) => {
      const existing = db.select().from(GlobalSettingsTable).where(eq(GlobalSettingsTable.key, MEMORY_MODEL_KEY)).get()

      if (existing) {
        db.update(GlobalSettingsTable).set({ value: model }).where(eq(GlobalSettingsTable.key, MEMORY_MODEL_KEY)).run()
      } else {
        db.insert(GlobalSettingsTable)
          .values({
            key: MEMORY_MODEL_KEY,
            value: model,
          })
          .run()
      }
    })
  }

  /**
   * Get all settings (for debugging/export)
   */
  export function getAll() {
    return Database.use((db) => {
      return db.select().from(GlobalSettingsTable).all()
    })
  }
}
