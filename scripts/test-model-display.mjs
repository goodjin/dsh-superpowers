#!/usr/bin/env node
/**
 * Tests for the model display-name work in lib/client.js.
 *
 * The browser half is a hand-written CommonJS factory for
 * `window.__ModuleLoader__`, so it cannot be imported — it is evaluated here
 * inside a sandboxed context with stubbed globals, the same way the page loads
 * it. Three contracts are exercised:
 *
 *   1. the factory registers under the PACKAGE NAME (the roster entry id) —
 *      any other id makes the browser refuse the whole module;
 *   2. the declared inject covers the model-catalog remote faces the subagent
 *      label reads — a face read without being declared throws at activation;
 *   3. apply() survives a HOSTILE context (every injected service method
 *      throws, no `process.stderr`) — the browser activation precheck's core
 *      degradation rule: a broken environment degrades the label, it never
 *      breaks the composer or the settings panel.
 *
 * Runs in this checkout with no dependencies:
 *
 *   node scripts/test-model-display.mjs
 *
 * Exit code 0 when every check passes, 1 otherwise.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const clientPath = join(here, '..', 'lib', 'client.js')
const source = readFileSync(clientPath, 'utf8')

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

/** Evaluate the bundle exactly as the page does and return its exports. */
function loadBundle() {
  let factory
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load({ id, factory: loaded }) {
          factory = loaded
          return { declaredId: id }
        },
      },
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })
  assert(typeof factory === 'function', '__ModuleLoader__.load 未收到工厂函数')
  const stubRequire = (name) => {
    if (name === 'react') {
      const React = { createElement: (type, props, ...children) => ({ type, props, children }) }
      React.useState = () => [undefined, () => {}]
      React.useEffect = () => {}
      return React
    }
    if (name === 'react/jsx-runtime') return {}
    throw new Error(`unexpected require(${name})`)
  }
  const exports = factory(stubRequire)
  assert(exports !== null && typeof exports === 'object', '工厂未返回 module.exports')
  return { declaredId: sandbox.__lastDeclaredId, exports, sandbox }
}

console.log('模型显示名测试 — lib/client.js\n')

await test('浏览器模块 id 自报为包名（名册契约）', () => {
  const declared = source.match(/__ModuleLoader__\.load\(\{\s*id:\s*['"]([^'"]+)['"]/)?.[1]
  assert(typeof declared === 'string', '找不到 __ModuleLoader__.load({id}) 声明')
  const normalized = declared.endsWith('/client') ? declared.slice(0, -7) : declared
  const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).name
  assert(normalized === pkg, `自报 id「${declared}」≠ 包名「${pkg}」——浏览器会拒绝加载整包`)
})

await test('inject 声明覆盖模型目录的两个 remote 面', () => {
  const { exports } = loadBundle()
  for (const face of ['remote', 'remote.session']) {
    assert(Array.isArray(exports.inject) && exports.inject.includes(face),
      `inject 缺「${face}」——读未声明面会当场抛，激活直接失败`)
  }
})

await test('显示名代码路径齐备（下拉 + 子代理标签）', () => {
  for (const needle of ['loadModelNames', 'readProjectedRoute', 'providerName ?? option.provider', 'found.providerName} · ${found.modelName}']) {
    assert(source.includes(needle), `client.js 缺关键片段：${needle}`)
  }
  const hostSource = readFileSync(join(here, '..', 'lib', 'index.js'), 'utf8')
  for (const needle of ['providerName:', 'name: typeof model.name']) {
    assert(hostSource.includes(needle), `index.js 的 modelOptions 未带显示名：${needle}`)
  }
})

await test('apply() 在善意上下文注册两个插槽', () => {
  const { exports } = loadBundle()
  const registered = []
  const ctx = {
    slots: {
      inject(name, build) { build() },
      register(spec, render) { registered.push(spec.name) },
    },
    sessions: {},
    connection: {},
    remote: { session: {} },
  }
  exports.apply(ctx)
  assert(registered.includes('settings.section'), '未注册设置分区插槽')
  assert(registered.includes('conversation.input.left'), '未注册子代理模型标签插槽')
})

await test('apply() 在敌意上下文不抛（降级契约）', () => {
  const { exports } = loadBundle()
  // Exactly the activation precheck's renderer shape: declared services are
  // facades whose every METHOD call throws; undeclared access throws at once.
  const injectDeclared = exports.inject
  const services = new Proxy({}, {
    get(_t, k) {
      if (typeof k !== 'string') return undefined
      if (!injectDeclared.includes(k)) throw new Error(`cannot get "${k}" without inject`)
      const degrade = () => { throw new Error(`[fault-injection] ${k} 已降级`) }
      return new Proxy({}, { get(_t2, prop) {
        if (typeof prop === 'symbol') return undefined
        return degrade
      } })
    },
  })
  // The degraded renderer has no `process.stderr` either; a diagnostic write
  // through it would be a second TypeError piercing apply().
  const hardened = globalThis.process
  delete globalThis.process
  try {
    exports.apply(services)
  } finally {
    globalThis.process = hardened
  }
})

console.log(`\n${passed} 通过，${failures.length} 失败`)
if (failures.length > 0) {
  console.error(`失败的测试：${failures.join('、')}`)
  process.exit(1)
}
