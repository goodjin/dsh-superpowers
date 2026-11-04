#!/usr/bin/env node
/**
 * Preset ↔ declaration sync test.
 *
 * `preset/agent.cordis.yml` is the authoritative plugin list of the Superpowers
 * preset; `cordis.patch.yml` embeds the same list verbatim inside the
 * `superpowers-preset` declaration row. The embed is maintained by hand, so the
 * two can drift — and a drifted preset is not a visible failure: the mounted
 * tree just lacks (or duplicates) a row. This test pins the two lists together:
 *
 *   1. every id+name row in preset/agent.cordis.yml must appear in the
 *      declaration's inlined plugin list, and
 *   2. every id+name row in the declaration that is NOT part of the preset
 *      must be one of the four host-plane rows declared here on purpose
 *      (delegation settings, the delegation service, browser half, the
 *      preset row itself).
 *
 * Commented-out lines are ignored on both sides. Exit 0 when in sync, 1 when
 * drifted, with the offending rows named.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const presetPath = join(root, 'preset', 'agent.cordis.yml')
const patchPath = join(root, 'cordis.patch.yml')

/** Rows that live in the bundle declaration but are intentionally not preset plugins. */
const HOST_PLANE_ROWS = new Set([
  'superpowers-delegation-settings',
  'superpowers-delegation-service',
  'superpowers-client',
  'superpowers-preset',
])

/** Strip `#` comments (full-line only — the files never use trailing comments), then collect id/name pairs. */
function rowsOf(text) {
  const lines = text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
  const rows = new Map()
  let pendingId = null
  for (const line of lines) {
    // 只有列表项形式（`- id:`）才是装载行；声明行 config 里的 `id:`（如显示名 id）不是。
    const id = line.match(/^\s*-\s+id:\s*([^\s'"]+|'[^']*'|"[^"]*")\s*$/)
    if (id) {
      pendingId = id[1].replace(/^['"]|['"]$/g, '')
      continue
    }
    const name = line.match(/^\s*name:\s*([^\s'"]+|'[^']*'|"[^"]*")\s*$/)
    if (name && pendingId !== null) {
      rows.set(pendingId, name[1].replace(/^['"]|['"]$/g, ''))
      pendingId = null
    }
  }
  return rows
}

const preset = rowsOf(readFileSync(presetPath, 'utf8'))
const patch = rowsOf(readFileSync(patchPath, 'utf8'))

const failures = []

for (const [id, name] of preset) {
  if (patch.get(id) !== name) {
    failures.push(`preset 行 ${id} (${name}) 在 cordis.patch.yml 内联清单里缺失或名字不一致`)
  }
}
for (const [id, name] of patch) {
  if (preset.has(id)) continue
  if (!HOST_PLANE_ROWS.has(id)) {
    failures.push(`cordis.patch.yml 里的行 ${id} (${name}) 不在预设清单里，也不是已知的主机侧行`)
  }
}

if (failures.length > 0) {
  console.log('\npreset ↔ 声明同步测试 — 不通过：')
  for (const failure of failures) console.log(`  ✗  ${failure}`)
  process.exit(1)
}
console.log(`\npreset ↔ 声明同步测试 — 一致（预设 ${preset.size} 行 + 主机侧 ${patch.size - preset.size} 行）。\n`)
