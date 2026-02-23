#!/usr/bin/env node

import fs from "fs"
import path from "path"
import os from "os"
import { fileURLToPath } from "url"
import { createRequire } from "module"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

function detectPlatformAndArch() {
  // Map platform names
  let platform
  switch (os.platform()) {
    case "darwin":
      platform = "darwin"
      break
    case "linux":
      platform = "linux"
      break
    case "win32":
      platform = "windows"
      break
    default:
      platform = os.platform()
      break
  }

  // Map architecture names
  let arch
  switch (os.arch()) {
    case "x64":
      arch = "x64"
      break
    case "arm64":
      arch = "arm64"
      break
    case "arm":
      arch = "arm"
      break
    default:
      arch = os.arch()
      break
  }

  return { platform, arch }
}

function findBinary() {
  const { platform, arch } = detectPlatformAndArch()
  const packageName = `openzero-${platform}-${arch}`
  const binaryName = platform === "windows" ? "openzero.exe" : "openzero"

  try {
    // Use require.resolve to find the package
    const packageJsonPath = require.resolve(`${packageName}/package.json`)
    const packageDir = path.dirname(packageJsonPath)
    const binaryPath = path.join(packageDir, "bin", binaryName)

    if (!fs.existsSync(binaryPath)) {
      throw new Error(`Binary not found at ${binaryPath}`)
    }

    return { binaryPath, binaryName }
  } catch (error) {
    throw new Error(`Could not find package ${packageName}: ${error.message}`)
  }
}

function prepareBinDirectory(binaryName) {
  const binDir = path.join(__dirname, "bin")
  const targetPath = path.join(binDir, binaryName)

  // Ensure bin directory exists
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true })
  }

  // Remove existing binary/symlink if it exists
  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath)
  }

  return { binDir, targetPath }
}

function symlinkBinary(sourcePath, binaryName) {
  const { targetPath } = prepareBinDirectory(binaryName)

  fs.symlinkSync(sourcePath, targetPath)
  console.log(`openzero binary symlinked: ${targetPath} -> ${sourcePath}`)

  // Verify the file exists after operation
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Failed to symlink binary to ${targetPath}`)
  }
}

async function downloadQdrant() {
  const { platform, arch } = detectPlatformAndArch()
  const homeDir = os.homedir()
  const qdrantDir = path.join(homeDir, ".local", "share", "openzero", "bin")

  // Create OpenZero directories
  fs.mkdirSync(qdrantDir, { recursive: true })
  fs.mkdirSync(path.join(homeDir, ".config", "openzero"), { recursive: true })
  fs.mkdirSync(path.join(homeDir, ".local", "share", "openzero", "memory"), { recursive: true })

  const qdrantVersion = "v1.12.5"
  let qdrantUrl = ""
  let qdrantBinary = "qdrant"

  switch (platform) {
    case "linux":
      qdrantUrl = `https://github.com/qdrant/qdrant/releases/download/${qdrantVersion}/qdrant-x86_64-unknown-linux-musl.tar.gz`
      break
    case "darwin":
      if (arch === "arm64") {
        qdrantUrl = `https://github.com/qdrant/qdrant/releases/download/${qdrantVersion}/qdrant-aarch64-apple-darwin.tar.gz`
      } else {
        qdrantUrl = `https://github.com/qdrant/qdrant/releases/download/${qdrantVersion}/qdrant-x86_64-apple-darwin.tar.gz`
      }
      break
    case "windows":
      qdrantUrl = `https://github.com/qdrant/qdrant/releases/download/${qdrantVersion}/qdrant-x86_64-pc-windows-msvc.zip`
      qdrantBinary = "qdrant.exe"
      break
    default:
      console.log(`Qdrant auto-install not supported for ${platform} - skipping`)
      return
  }

  const qdrantPath = path.join(qdrantDir, qdrantBinary)

  // Skip if already installed
  if (fs.existsSync(qdrantPath)) {
    console.log(`Qdrant already installed at ${qdrantPath}`)
    return
  }

  console.log("Downloading Qdrant for memory system...")

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qdrant-"))
  const archivePath = path.join(tmpDir, platform === "windows" ? "qdrant.zip" : "qdrant.tar.gz")

  try {
    // Download
    await execAsync(`curl -L -o "${archivePath}" "${qdrantUrl}"`)

    // Extract
    if (platform === "windows") {
      await execAsync(`unzip -q "${archivePath}" -d "${tmpDir}"`)
    } else {
      await execAsync(`tar -xzf "${archivePath}" -C "${tmpDir}"`)
    }

    // Move to final location
    const extractedBinary = path.join(tmpDir, qdrantBinary)
    fs.renameSync(extractedBinary, qdrantPath)
    fs.chmodSync(qdrantPath, 0o755)

    console.log(`✓ Qdrant installed to ${qdrantPath}`)
  } catch (error) {
    console.warn(`Warning: Failed to install Qdrant: ${error.message}`)
  } finally {
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

async function main() {
  try {
    if (os.platform() === "win32") {
      // On Windows, the .exe is already included in the package and bin field points to it
      // No postinstall setup needed
      console.log("Windows detected: binary setup not needed (using packaged .exe)")
      return
    }

    // On non-Windows platforms, just verify the binary package exists
    // Don't replace the wrapper script - it handles binary execution
    const { binaryPath } = findBinary()
    console.log(`Platform binary verified at: ${binaryPath}`)
    console.log("Wrapper script will handle binary execution")

    // Download Qdrant for memory system
    await downloadQdrant()
  } catch (error) {
    console.error("Failed to setup openzero binary:", error.message)
    process.exit(1)
  }
}

try {
  main()
} catch (error) {
  console.error("Postinstall script error:", error.message)
  process.exit(0)
}
