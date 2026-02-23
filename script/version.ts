#!/usr/bin/env bun

import { Script } from "@openzero/script"

const output = [`version=${Script.version}`]
const repo = process.env.GH_REPO ?? "codercodingthecode/openzero"
const token = process.env.GH_TOKEN

async function ghApi(endpoint: string, options?: RequestInit) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`)
  return res.json()
}

if (!Script.preview || Script.channel === "beta") {
  const tag = `v${Script.version}`
  const body = `Release ${tag}`
  const release = await ghApi(`/repos/${repo}/releases`, {
    method: "POST",
    body: JSON.stringify({
      tag_name: tag,
      name: tag,
      body,
      draft: true,
      prerelease: Script.preview,
    }),
  })
  output.push(`release=${release.id}`)
  output.push(`tag=${tag}`)
}

output.push(`repo=${process.env.GH_REPO}`)

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, output.join("\n"))
}

process.exit(0)
