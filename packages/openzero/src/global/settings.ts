import { Database } from "../storage/db"
import { GlobalSettingsTable } from "./global.sql"
import { eq } from "drizzle-orm"

/**
 * Global settings stored in SQLite (not JSON files)
 */
export namespace GlobalSettings {
  const SINGLETON_ID = "singleton"

  /**
   * Get the memory model setting
   * @returns Memory model string (e.g., 'github-copilot/gpt-5-mini') or null if not set
   */
  export function getMemoryModel(): string | null {
    return Database.use((db) => {
      const row = db.select().from(GlobalSettingsTable).where(eq(GlobalSettingsTable.id, SINGLETON_ID)).get()
      return row?.memory_model ?? null
    })
  }

  /**
   * Set the memory model setting
   * @param model Memory model string (e.g., 'github-copilot/gpt-5-mini')
   */
  export function setMemoryModel(model: string): void {
    const now = Date.now()
    Database.use((db) => {
      const existing = db.select().from(GlobalSettingsTable).where(eq(GlobalSettingsTable.id, SINGLETON_ID)).get()

      if (existing) {
        db.update(GlobalSettingsTable)
          .set({ memory_model: model, time_updated: now })
          .where(eq(GlobalSettingsTable.id, SINGLETON_ID))
          .run()
      } else {
        db.insert(GlobalSettingsTable)
          .values({
            id: SINGLETON_ID,
            memory_model: model,
            time_created: now,
            time_updated: now,
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
      return db.select().from(GlobalSettingsTable).where(eq(GlobalSettingsTable.id, SINGLETON_ID)).get()
    })
  }
}
