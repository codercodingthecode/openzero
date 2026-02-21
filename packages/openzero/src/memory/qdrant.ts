import { Log } from "../util/log"
import path from "path"
import os from "os"
import { spawn, type ChildProcess } from "child_process"
import { Global } from "../global"
import fs from "fs/promises"
import { existsSync } from "fs"

export namespace QdrantManager {
  const log = Log.create({ service: "qdrant" })

  const QDRANT_VERSION = "v1.17.0"
  const DOWNLOAD_BASE = "https://github.com/qdrant/qdrant/releases/download"

  let process: ChildProcess | null = null
  let isStarting = false

  interface QdrantConfig {
    host: string
    port: number
    auto_start: boolean
  }

  function getBinaryPath(): string {
    return path.join(Global.Path.bin, "qdrant")
  }

  function getDataPath(): string {
    return path.join(Global.Path.data, "memory", "qdrant-data")
  }

  function getConfigPath(): string {
    return path.join(Global.Path.data, "memory", "qdrant-config.yaml")
  }

  function getPlatformArchiveName(): string {
    const platform = os.platform()
    const arch = os.arch()

    if (platform === "darwin") {
      return arch === "arm64" ? "qdrant-aarch64-apple-darwin.tar.gz" : "qdrant-x86_64-apple-darwin.tar.gz"
    } else if (platform === "linux") {
      return arch === "arm64" ? "qdrant-aarch64-unknown-linux-musl.tar.gz" : "qdrant-x86_64-unknown-linux-musl.tar.gz"
    } else if (platform === "win32") {
      return "qdrant-x86_64-pc-windows-msvc.zip"
    }

    throw new Error(`Unsupported platform: ${platform}-${arch}`)
  }

  function getDownloadUrl(): string {
    const archiveName = getPlatformArchiveName()
    return `${DOWNLOAD_BASE}/${QDRANT_VERSION}/${archiveName}`
  }

  async function downloadBinary(): Promise<void> {
    const binaryPath = getBinaryPath()
    const binDir = path.dirname(binaryPath)

    // Create bin directory if it doesn't exist
    await fs.mkdir(binDir, { recursive: true })

    // Check if already downloaded
    if (existsSync(binaryPath)) {
      log.debug("qdrant binary already exists", { path: binaryPath })
      return
    }

    const url = getDownloadUrl()
    const archiveName = getPlatformArchiveName()
    const tempArchive = path.join(binDir, archiveName)

    log.info("downloading qdrant binary", { url, target: binaryPath })

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to download Qdrant: ${response.status} ${response.statusText}`)
    }

    // Download to temp file
    const buffer = await response.arrayBuffer()
    await fs.writeFile(tempArchive, new Uint8Array(buffer))

    // Extract archive
    const platform = os.platform()
    if (platform === "win32") {
      // TODO: Handle zip extraction for Windows
      throw new Error("Windows Qdrant extraction not implemented yet")
    } else {
      // Extract tar.gz using Bun shell
      await Bun.$`tar -xzf ${tempArchive} -C ${binDir}`.quiet()
      await fs.unlink(tempArchive)
    }

    await fs.chmod(binaryPath, 0o755)
    log.info("qdrant binary downloaded successfully", { path: binaryPath })
  }

  async function createConfig(port: number): Promise<void> {
    const configPath = getConfigPath()
    const dataPath = getDataPath()
    const configDir = path.dirname(configPath)

    await fs.mkdir(configDir, { recursive: true })
    await fs.mkdir(dataPath, { recursive: true })

    const config = `storage:
  storage_path: ${dataPath}
service:
  grpc_port: ${port + 1}
  http_port: ${port}
log_level: WARN
`

    await fs.writeFile(configPath, config, "utf-8")
    log.debug("qdrant config created", { path: configPath })
  }

  async function healthCheck(host: string, port: number, maxRetries = 30): Promise<boolean> {
    const url = `http://${host}:${port}/healthz`

    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
        if (response.ok) {
          log.debug("qdrant health check passed", { url })
          return true
        }
      } catch (err) {
        // Ignore errors during startup
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    log.error("qdrant health check failed", { url, maxRetries })
    return false
  }

  async function isPortInUse(host: string, port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://${host}:${port}/healthz`, { signal: AbortSignal.timeout(1000) })
      return response.ok
    } catch {
      return false
    }
  }

  export async function start(config: QdrantConfig): Promise<void> {
    const { host, port, auto_start } = config

    // Check if Qdrant is already running
    const alreadyRunning = await isPortInUse(host, port)
    if (alreadyRunning) {
      log.info("qdrant already running, reusing existing instance", { host, port })
      return
    }

    if (!auto_start) {
      log.warn("qdrant auto_start is disabled, memory system will not work without manual Qdrant setup", {
        host,
        port,
      })
      return
    }

    if (process !== null || isStarting) {
      log.debug("qdrant start already in progress")
      return
    }

    isStarting = true

    try {
      // Download binary if needed
      await downloadBinary()

      // Create config
      await createConfig(port)

      const binaryPath = getBinaryPath()
      const configPath = getConfigPath()

      log.info("starting qdrant server", { binary: binaryPath, config: configPath })

      process = spawn(binaryPath, ["--config-path", configPath], {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      })

      process.stdout?.on("data", (data) => {
        log.debug("qdrant stdout", { output: data.toString().trim() })
      })

      process.stderr?.on("data", (data) => {
        log.debug("qdrant stderr", { output: data.toString().trim() })
      })

      process.on("error", (err) => {
        log.error("qdrant process error", { error: err })
        process = null
      })

      process.on("exit", (code, signal) => {
        log.info("qdrant process exited", { code, signal })
        process = null

        // Auto-restart if crashed unexpectedly (not a graceful shutdown)
        if (code !== 0 && code !== null && auto_start) {
          log.warn("qdrant crashed, restarting in 5 seconds", { code })
          setTimeout(() => {
            start(config).catch((err) => {
              log.error("failed to restart qdrant", { error: err })
            })
          }, 5000)
        }
      })

      // Wait for Qdrant to be healthy
      const healthy = await healthCheck(host, port)
      if (!healthy) {
        throw new Error("Qdrant failed to start (health check timeout)")
      }

      log.info("qdrant server started successfully", { host, port })
    } finally {
      isStarting = false
    }
  }

  export async function stop(): Promise<void> {
    if (process === null) {
      log.debug("qdrant process not running, nothing to stop")
      return
    }

    log.info("stopping qdrant server")

    return new Promise((resolve) => {
      if (!process) {
        resolve()
        return
      }

      process.on("exit", () => {
        log.info("qdrant server stopped")
        process = null
        resolve()
      })

      process.kill("SIGTERM")

      // Force kill after 5 seconds if not stopped
      setTimeout(() => {
        if (process) {
          log.warn("qdrant did not stop gracefully, force killing")
          process.kill("SIGKILL")
        }
      }, 5000)
    })
  }

  export function isRunning(): boolean {
    return process !== null
  }
}
