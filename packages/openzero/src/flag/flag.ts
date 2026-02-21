function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

export namespace Flag {
  export const OPENZERO_AUTO_SHARE = truthy("OPENZERO_AUTO_SHARE")
  export const OPENZERO_GIT_BASH_PATH = process.env["OPENZERO_GIT_BASH_PATH"]
  export const OPENZERO_CONFIG = process.env["OPENZERO_CONFIG"]
  export declare const OPENZERO_CONFIG_DIR: string | undefined
  export const OPENZERO_CONFIG_CONTENT = process.env["OPENZERO_CONFIG_CONTENT"]
  export const OPENZERO_DISABLE_AUTOUPDATE = truthy("OPENZERO_DISABLE_AUTOUPDATE")
  export const OPENZERO_DISABLE_PRUNE = truthy("OPENZERO_DISABLE_PRUNE")
  export const OPENZERO_DISABLE_TERMINAL_TITLE = truthy("OPENZERO_DISABLE_TERMINAL_TITLE")
  export const OPENZERO_PERMISSION = process.env["OPENZERO_PERMISSION"]
  export const OPENZERO_DISABLE_DEFAULT_PLUGINS = truthy("OPENZERO_DISABLE_DEFAULT_PLUGINS")
  export const OPENZERO_DISABLE_LSP_DOWNLOAD = truthy("OPENZERO_DISABLE_LSP_DOWNLOAD")
  export const OPENZERO_ENABLE_EXPERIMENTAL_MODELS = truthy("OPENZERO_ENABLE_EXPERIMENTAL_MODELS")
  export const OPENZERO_DISABLE_AUTOCOMPACT = truthy("OPENZERO_DISABLE_AUTOCOMPACT")
  export const OPENZERO_DISABLE_MODELS_FETCH = truthy("OPENZERO_DISABLE_MODELS_FETCH")
  export const OPENZERO_DISABLE_CLAUDE_CODE = truthy("OPENZERO_DISABLE_CLAUDE_CODE")
  export const OPENZERO_DISABLE_CLAUDE_CODE_PROMPT =
    OPENZERO_DISABLE_CLAUDE_CODE || truthy("OPENZERO_DISABLE_CLAUDE_CODE_PROMPT")
  export const OPENZERO_DISABLE_CLAUDE_CODE_SKILLS =
    OPENZERO_DISABLE_CLAUDE_CODE || truthy("OPENZERO_DISABLE_CLAUDE_CODE_SKILLS")
  export const OPENZERO_DISABLE_EXTERNAL_SKILLS =
    OPENZERO_DISABLE_CLAUDE_CODE_SKILLS || truthy("OPENZERO_DISABLE_EXTERNAL_SKILLS")
  export declare const OPENZERO_DISABLE_PROJECT_CONFIG: boolean
  export const OPENZERO_FAKE_VCS = process.env["OPENZERO_FAKE_VCS"]
  export declare const OPENZERO_CLIENT: string
  export const OPENZERO_SERVER_PASSWORD = process.env["OPENZERO_SERVER_PASSWORD"]
  export const OPENZERO_SERVER_USERNAME = process.env["OPENZERO_SERVER_USERNAME"]
  export const OPENZERO_ENABLE_QUESTION_TOOL = truthy("OPENZERO_ENABLE_QUESTION_TOOL")

  // Experimental
  export const OPENZERO_EXPERIMENTAL = truthy("OPENZERO_EXPERIMENTAL")
  export const OPENZERO_EXPERIMENTAL_FILEWATCHER = truthy("OPENZERO_EXPERIMENTAL_FILEWATCHER")
  export const OPENZERO_EXPERIMENTAL_DISABLE_FILEWATCHER = truthy("OPENZERO_EXPERIMENTAL_DISABLE_FILEWATCHER")
  export const OPENZERO_EXPERIMENTAL_ICON_DISCOVERY =
    OPENZERO_EXPERIMENTAL || truthy("OPENZERO_EXPERIMENTAL_ICON_DISCOVERY")

  const copy = process.env["OPENZERO_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const OPENZERO_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("OPENZERO_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const OPENZERO_ENABLE_EXA =
    truthy("OPENZERO_ENABLE_EXA") || OPENZERO_EXPERIMENTAL || truthy("OPENZERO_EXPERIMENTAL_EXA")
  export const OPENZERO_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("OPENZERO_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const OPENZERO_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("OPENZERO_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const OPENZERO_EXPERIMENTAL_OXFMT = OPENZERO_EXPERIMENTAL || truthy("OPENZERO_EXPERIMENTAL_OXFMT")
  export const OPENZERO_EXPERIMENTAL_LSP_TY = truthy("OPENZERO_EXPERIMENTAL_LSP_TY")
  export const OPENZERO_EXPERIMENTAL_LSP_TOOL = OPENZERO_EXPERIMENTAL || truthy("OPENZERO_EXPERIMENTAL_LSP_TOOL")
  export const OPENZERO_DISABLE_FILETIME_CHECK = truthy("OPENZERO_DISABLE_FILETIME_CHECK")
  export const OPENZERO_EXPERIMENTAL_PLAN_MODE = OPENZERO_EXPERIMENTAL || truthy("OPENZERO_EXPERIMENTAL_PLAN_MODE")
  export const OPENZERO_EXPERIMENTAL_MARKDOWN = truthy("OPENZERO_EXPERIMENTAL_MARKDOWN")
  export const OPENZERO_MODELS_URL = process.env["OPENZERO_MODELS_URL"]
  export const OPENZERO_MODELS_PATH = process.env["OPENZERO_MODELS_PATH"]

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for OPENZERO_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "OPENZERO_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("OPENZERO_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENZERO_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "OPENZERO_CONFIG_DIR", {
  get() {
    return process.env["OPENZERO_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENZERO_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "OPENZERO_CLIENT", {
  get() {
    return process.env["OPENZERO_CLIENT"] ?? "cli"
  },
  enumerable: true,
  configurable: false,
})
