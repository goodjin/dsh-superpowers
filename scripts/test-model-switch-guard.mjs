#!/usr/bin/env node
/**
 * Model-switch compaction guard: wiring + behaviour tests.
 *
 * The host rejects a model switch when the pre-switch context compaction fails
 * (MODEL_SWITCH_COMPACTION_FAILED). This preset installs an outer
 * `agent/request` listener that turns ONLY that failure into a warning plus a
 * visible session notice, and lets the switch proceed.
 *
 * Two contracts cannot be covered by runtime try/catch and only tests can:
 *
 *   1. WIRING — the row must exist in BOTH the authoritative preset plugin list
 *      and the inlined declaration, AFTER the compaction row, and the module
 *      must be reachable through a package export. A missing/ misordered row is
 *      the classic "installed but inactive" silent failure.
 *   2. LOAD SAFETY — a preset mount is whole-tree: if the module fails to
 *      IMPORT (or apply() throws), every sibling row rolls back. So the module
 *      must import with no peer deps present and apply() must never throw.
 *
 * Exit 0 when every check passes, 1 otherwise.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const presetPath = join(root, 'preset', 'agent.cordis.yml')
const patchPath = join(root, 'cordis.patch.yml')
const packagePath = join(root, 'package.json')
const modulePath = join(root, 'lib', 'model-switch-guard.js')

const ROW_ID = 'superpowers-model-switch-guard'
const ROW_NAME = '@goodjin2/dsh-superpowers/model-switch-guard'
const EXPORT_KEY = './model-switch-guard'
const TEST_FILE = 'test-model-switch-guard.mjs'

const failures = []
let passed = 0

async function test(name, run) {
  try {
    await run()
    passed += 1
    console.log(`  ✓  ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`  ✗  ${name}\n      ${error instanceof Error ? error.message : String(error)}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function read(path) {
  return readFileSync(path, 'utf8')
}

/** Collect `- id:` / `name:` loader rows in declaration order (full-line comments ignored). */
function rowsInOrder(text) {
  const rows = []
  let pendingId = null
  for (const line of text.split('\n')) {
    if (/^\s*#/.test(line)) continue
    const id = line.match(/^\s*-\s+id:\s*([^\s'"]+|'[^']*'|"[^"]*")\s*$/)
    if (id) {
      pendingId = id[1].replace(/^['"]|['"]$/g, '')
      continue
    }
    const name = line.match(/^\s*name:\s*([^\s'"]+|'[^']*'|"[^"]*")\s*$/)
    if (name && pendingId !== null) {
      rows.push({ id: pendingId, name: name[1].replace(/^['"]|['"]$/g, '') })
      pendingId = null
    }
  }
  return rows
}

/** A minimal cordis-like ctx that records registrations, warnings and appends. */
function fakeCtx({ inner, agent, signal } = {}) {
  const hooks = []
  const warnings = []
  const appends = []
  const ctx = {
    on(name, listener, options) {
      hooks.push({ name, listener, options })
      return () => {}
    },
    logger: {
      warn: (message) => warnings.push(String(message)),
      info: () => {},
    },
  }
  return { ctx, hooks, warnings, appends, agent, signal, inner }
}

function fakeAgent(selection) {
  const appended = []
  return {
    model: { current: () => selection },
    session: {
      requestHeader: () => ({ config: { provider: 'old-provider', model: 'old-model', maxTokens: 4096 } }),
      append: (type, data, options) => appended.push({ type, data, options }),
    },
    appended,
  }
}

/** Run the registered waterfall listener with a synthetic inner `next()`. */
async function runHook(listener, { agent, signal, inner }) {
  const payload = { turn: 1, step: 1, agent, signal: signal ?? { aborted: false } }
  return listener(payload, inner)
}

// ── WIRING ──────────────────────────────────────────────────────────────────

await test('package.json exports the guard submodule', () => {
  const pkg = JSON.parse(read(packagePath))
  assert(pkg.exports?.[EXPORT_KEY] === './lib/model-switch-guard.js',
    `missing ${EXPORT_KEY} export pointing at lib/model-switch-guard.js`)
})

await test('package.json npm test runs this suite', () => {
  const pkg = JSON.parse(read(packagePath))
  assert(String(pkg.scripts?.test ?? '').includes(TEST_FILE),
    `scripts.test does not include ${TEST_FILE}`)
})

for (const [label, path] of [['preset/agent.cordis.yml', presetPath], ['cordis.patch.yml', patchPath]]) {
  await test(`${label} declares the guard row inside the compaction group, depending on compaction`, () => {
    const text = read(path)
    const rows = rowsInOrder(text)
    const guardAt = rows.findIndex((row) => row.id === ROW_ID)
    const compactionAt = rows.findIndex((row) => row.id === 'compaction-basic')
    assert(guardAt !== -1, `${ROW_ID} row is missing`)
    assert(rows[guardAt].name === ROW_NAME, `row name is ${rows[guardAt].name}, expected ${ROW_NAME}`)
    assert(compactionAt !== -1, 'compaction-basic row is missing (cannot verify group/deps)')
    // The guard must NOT be a top-level preset row: it belongs INSIDE the
    // compaction group's config list, so it shares the isolated realm where
    // the host's compaction `agent/request` hook is registered.
    const guardLine = text.split('\n').find((line) => line.includes(`id: ${ROW_ID}`))
    assert(/^\s{4,}-/.test(guardLine ?? ''),
      'guard row must be indented as a child of the compaction group config, not top-level')
    // Declaration order cannot guarantee registration order (the loader
    // activates rows concurrently). `inject: ['compaction']` is what makes the
    // host wait for the compaction engine to be fully installed first.
    const afterGuard = text.slice(text.indexOf(guardLine))
    const guardBlock = afterGuard.split(/\n\s*-\s+id:/)[0]
    assert(/inject:\s*\[\s*['"]?compaction['"]?\s*\]/.test(guardBlock),
      "guard row must declare `inject: ['compaction']` so it installs after the compaction hook")
  })
}

// ── LOAD SAFETY ─────────────────────────────────────────────────────────────

let mod = null
await test('module imports with no peer dependencies installed', async () => {
  mod = await import(pathToFileURL(modulePath).href)
  assert(typeof mod.apply === 'function', 'module has no apply() export')
  assert(typeof mod.name === 'string' && mod.name.length > 0, 'module has no name export')
})

await test('apply() never throws, even with a broken ctx', () => {
  assert(mod !== null, 'module did not import')
  let threw = false
  try {
    mod.apply({ on() { throw new Error('ctx.on unavailable') } })
  } catch {
    threw = true
  }
  assert(!threw, 'apply() threw out of a broken ctx — a preset mount would roll back')
})

// ── BEHAVIOUR ───────────────────────────────────────────────────────────────

await test('apply() registers one prepend agent/request listener', () => {
  assert(mod !== null, 'module did not import')
  const { ctx, hooks } = fakeCtx()
  mod.apply(ctx)
  const matches = hooks.filter((hook) => hook.name === 'agent/request')
  assert(matches.length === 1, `expected exactly one agent/request hook, got ${matches.length}`)
  assert(matches[0].options?.prepend === true, 'hook must be prepend so it registers outermost')
})

await test('successful switch passes the config through untouched', async () => {
  assert(mod !== null, 'module did not import')
  const selection = { provider: 'new-provider', model: 'new-model' }
  const agent = fakeAgent(selection)
  const config = { provider: 'new-provider', model: 'new-model', maxTokens: 4096 }
  const { ctx, hooks, warnings } = fakeCtx({ inner: async () => config, agent })
  mod.apply(ctx)
  const result = await runHook(hooks[0].listener, { agent, inner: async () => config })
  assert(result === config, 'config was not returned as-is')
  assert(warnings.length === 0, `unexpected warnings: ${warnings.join(' | ')}`)
  assert(agent.appended.length === 0, 'notice appended on a successful switch')
})

await test('MODEL_SWITCH_COMPACTION_FAILED warns, appends a visible notice, returns the new config', async () => {
  assert(mod !== null, 'module did not import')
  const selection = { provider: 'new-provider', model: 'new-model' }
  const agent = fakeAgent(selection)
  const { ctx, hooks, warnings } = fakeCtx()
  mod.apply(ctx)
  const failure = Object.assign(new Error('Cannot switch to x/y: context compaction failed: MiniMax request failed (429)'), {
    code: 'MODEL_SWITCH_COMPACTION_FAILED',
  })
  const result = await runHook(hooks[0].listener, {
    agent,
    inner: async () => { throw failure },
  })
  assert(result?.provider === 'new-provider' && result?.model === 'new-model',
    `fallback config wrong: ${JSON.stringify(result)}`)
  assert(warnings.length === 1, `expected one warning, got ${warnings.length}`)
  assert(agent.appended.length === 1, `expected one visible notice, got ${agent.appended.length}`)
  const notice = agent.appended[0]
  assert(notice.type === 'user/message', `notice type is ${notice.type}`)
  assert(notice.options?.surfaceOp === 'append', 'notice is not appended to the surface')
  assert(notice.data?.role === 'user', 'notice role is not user')
  assert(typeof notice.data?.id === 'string' && notice.data.id.length > 0, 'notice has no id')
  assert(Array.isArray(notice.data?.content) && notice.data.content[0]?.type === 'text',
    'notice has no text content')
  assert(notice.data?.source?.kind === 'model-selection', 'notice source.kind is not model-selection')
  assert(/压缩|切换/.test(notice.data.content[0].text), 'notice text is not the compaction warning')
})

await test('other errors are rethrown unchanged, with no notice', async () => {
  assert(mod !== null, 'module did not import')
  const selection = { provider: 'new-provider', model: 'new-model' }
  const agent = fakeAgent(selection)
  const { ctx, hooks } = fakeCtx()
  mod.apply(ctx)
  const failure = Object.assign(new Error('boom'), { code: 'SOMETHING_ELSE' })
  let caught = null
  try {
    await runHook(hooks[0].listener, { agent, inner: async () => { throw failure } })
  } catch (error) {
    caught = error
  }
  assert(caught === failure, 'error was swallowed or replaced')
  assert(agent.appended.length === 0, 'notice appended for an unrelated error')
})

await test('an aborted signal is never turned into a successful switch', async () => {
  assert(mod !== null, 'module did not import')
  const selection = { provider: 'new-provider', model: 'new-model' }
  const agent = fakeAgent(selection)
  const { ctx, hooks } = fakeCtx()
  mod.apply(ctx)
  const failure = Object.assign(new Error('aborted'), { code: 'MODEL_SWITCH_COMPACTION_FAILED' })
  let caught = null
  try {
    await runHook(hooks[0].listener, {
      agent,
      signal: { aborted: true },
      inner: async () => { throw failure },
    })
  } catch (error) {
    caught = error
  }
  assert(caught === failure, 'aborted failure was swallowed')
  assert(agent.appended.length === 0, 'notice appended for an aborted request')
})

await test('module exports inject/name/apply in the shape the loader unwraps', () => {
  assert(mod !== null, 'module did not import')
  // unwrapExports(): exports = exports.default ?? exports; if !__esModule return exports.
  const unwrapped = mod.default ?? mod
  assert(typeof unwrapped.apply === 'function', 'loader would not find apply() after unwrapExports')
  assert(Array.isArray(unwrapped.inject) && unwrapped.inject.includes('compaction'),
    'loader would not wait for the compaction service')
  assert(typeof unwrapped.name === 'string', 'loader would not get the plugin name')
})

if (failures.length > 0) {
  console.log(`\nmodel-switch guard suite — 不通过：${failures.length} 项失败，${passed} 项通过`)
  for (const failure of failures) console.log(`  ✗  ${failure}`)
  process.exit(1)
}
console.log(`\nmodel-switch guard suite — ${passed} 项全部通过`)
