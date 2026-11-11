#!/usr/bin/env node
/**
 * Runtime ordering test with the REAL host Cordis.
 *
 * The unit suite proves the guard's own behaviour with a fake ctx. This one
 * proves the part a fake ctx cannot: with the host's actual event service,
 * agent-scope filtering, prepend ordering, and an isolated realm, the guard's
 * `agent/request` listener really does end up OUTSIDE the host compaction
 * hook and can catch its MODEL_SWITCH_COMPACTION_FAILED throw.
 *
 * This is the "installed but inactive" regression guard: a green unit suite
 * plus a wrong registration order would still leave the feature dead silent.
 *
 * Looks for Cordis in the desktop app.asar extraction or a CLI install. When
 * no host is present it reports SKIP (exit 0) — the unit suite still covers
 * behaviour, this file only adds the real-runtime ordering proof.
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { globSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function findCordis() {
  // Prefer persistent installs (they survive a reboot); the asar extraction
  // under /tmp is only a transient artifact of debugging this host version.
  const candidates = []
  for (const pattern of [
    join(homedir(), '.local', 'share', 'node-v*-darwin-*', 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'cordis', 'lib', 'index.js'),
    join(homedir(), '.local', 'share', 'node-v*-darwin-*', 'lib', 'node_modules', '@deepseek-ai', 'cordis', 'lib', 'index.js'),
  ]) {
    try { candidates.push(...globSync(pattern)) } catch {}
  }
  candidates.push(
    join(homedir(), 'github', 'dsh-plugins', 'node_modules', '@deepseek-ai', 'cordis', 'lib', 'index.js'),
    '/tmp/dsh-asar-extract/dsh/node_modules/@deepseek-ai/cordis/lib/index.js',
  )
  return candidates.find((p) => existsSync(p))
}

const cordisPath = findCordis()
if (cordisPath === undefined) {
  console.log('SKIP: host Cordis not found — real-runtime ordering not verified')
  process.exit(0)
}

const cordis = await import(pathToFileURL(cordisPath).href)
const { Context } = cordis
const guard = await import(pathToFileURL(join(root, 'lib', 'model-switch-guard.js')).href)

const ctxRoot = new Context() // installs events/logger/registry exactly as the host does
const warnings = []
ctxRoot.logger.warn = (message) => warnings.push(String(message))

// Agent-scope carrier: admit only hooks registered by contexts in our realm.
const carrier = { [Context.filter]: (hookCtx) => hookCtx.__realm === 'compaction' }
const compactionCtx = ctxRoot.extend(); compactionCtx.__realm = 'compaction'
const guardCtx = ctxRoot.extend(); guardCtx.__realm = 'compaction'

const order = []
// Host compaction hook registers FIRST — guaranteed by inject: ['compaction'].
compactionCtx.on('agent/request', async (_payload, next) => {
  order.push('compaction-enter')
  await next()
  order.push('compaction-after-next')
  const error = Object.assign(
    new Error('Cannot switch to new/model: context compaction failed: MiniMax 429'),
    { code: 'MODEL_SWITCH_COMPACTION_FAILED' },
  )
  throw error
}, { prepend: true })

// Guard registers AFTER -> prepend places it at the front (outermost).
guard.apply(guardCtx)

const agent = {
  model: { current: () => ({ provider: 'new', model: 'model' }) },
  session: {
    requestHeader: () => ({ config: { provider: 'old', model: 'old', maxTokens: 4096 } }),
    append: (...args) => order.push(`append:${args[0]}`),
  },
}
const seed = { provider: 'new', model: 'model', maxTokens: 4096 }
const config = await ctxRoot.waterfall(
  carrier, 'agent/request', { agent, signal: { aborted: false } },
  () => Promise.resolve(seed),
)

const failures = []
function check(condition, message) { if (!condition) failures.push(message) }

check(order.includes('compaction-enter'), 'host compaction hook never ran (scope filter or ordering is wrong)')
check(config?.provider === 'new' && config?.model === 'model', 'switch did not proceed — guard is not outermost')
check(order.includes('append:user/message'), 'no visible notice was appended')
check(warnings.length === 1, `expected one warning, got ${warnings.length}`)

if (failures.length) {
  console.log('\nreal-cordis ordering test — 不通过：')
  for (const failure of failures) console.log(`  ✗  ${failure}`)
  console.log(`  order=${JSON.stringify(order)} config=${JSON.stringify(config)}`)
  process.exit(1)
}
console.log(`real-cordis ordering test — 通过（${cordisPath}）`)
console.log(`  order=${JSON.stringify(order)}`)
console.log(`  config=${JSON.stringify(config)}`)
