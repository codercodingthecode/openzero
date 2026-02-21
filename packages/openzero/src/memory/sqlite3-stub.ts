// Stub for sqlite3 module to satisfy mem0ai's peer dependency
// We use disableHistory: true in mem0 config, so this is never actually called
export class Database {
  constructor(...args: any[]) {
    throw new Error("sqlite3 history store is disabled - use Qdrant only")
  }
}

export default {
  Database,
  verbose: () => ({ Database }),
}
