// Stub for sqlite3 to prevent native binding issues with Bun
const Database = class Database {
  constructor() {}
  close() {}
  run() {}
  get() {}
  all() {}
  exec() {}
}

const sqlite3 = {
  Database,
  verbose() {
    return this
  },
}

module.exports = sqlite3
module.exports.default = sqlite3
