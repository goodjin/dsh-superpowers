#!/usr/bin/env node
/**
 * Post-upgrade compatibility check for dsh-superpowers.
 *
 * Run this after every DSH upgrade, BEFORE concluding that the plugin works:
 *
 *   node ~/github/dsh-superpowers/scripts/check.mjs [port]
 *
 * Why this exists: the plugin's failure mode is silent. A DSH upgrade that
 * moves a settings signature, a fetch-route registry, or the session model
 * projection produces no error — the server boots and the feature quietly
 * stops existing. Reading the browser tells you nothing; the only honest
 * signal is asking each dependency whether it is still where this plugin
 * expects it.
 *
 * It boots nothing. It only talks to an ALREADY RUNNING instance, so it can
 * never be the thing that breaks a machine. A connection failure is reported
 * as "could not reach the server", not as a plugin failure — those are very
 * different problems and confusing them would send you hunting in the wrong
 * place.
 *
 * Exit code 0 when every check passes, 1 otherwise. Safe to put in a script.
 */

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_PORT = 3080

/**
 * The route sits behind the same auth as the page, and DSH mints a fresh token
 * per process start with no configured value to read. So the token is a
 * required input, and the failure mode for a missing one is a clear
 * instruction rather than a "plugin broken" verdict — those send you debugging
 * the wrong thing entirely.
 */
const TOKEN = process.env.DSH_TOKEN ?? process.argv[3] ?? null
if (TOKEN === null) {
  console.log(
    '\n用法：node scripts/check.mjs <端口> <token> [预设文件]\n'
      + 'token 在你打开 DSH 那个地址里：\n'
      + '  http://127.0.0.1:<端口>/?token=……\n'
      + '也可以用环境变量 DSH_TOKEN。\n'
      + '每次重启 DSH 都会换一个新 token。\n'
      + '预设文件默认是本机正在用的那份；传路径可以查别的副本。\n',
  )
  process.exit(2)
}

/**
 * DSH's auth is a cookie exchange, not a header: the root URL with ?token=...
 * answers with a signed Set-Cookie, and every later call presents that cookie.
 * Node's fetch has no cookie jar, so the exchange is done by hand and the
 * cookie replayed — the same two steps a browser takes.
 */
let COOKIE = null

async function exchange(port) {
  const response = await fetch(`http://127.0.0.1:${port}/?token=${TOKEN}`, { redirect: 'manual' })
  const raw = response.headers.getSetCookie?.() ?? []
  const pair = raw.map((c) => c.split(';')[0]).find((c) => c.length > 0)
  if (pair === undefined) throw new Error('token 换了没换到凭证，地址栏里的 token 可能已失效')
  COOKIE = pair
}


/**
 * Does the exact fetch route exist at all?
 *
 * This is a SEPARATE check from `连接` on purpose. The connection check asks
 * for diagnostics and reports the envelope; if the route is absent the shared
 * /api handler answers 404 with a plain-text body, which the diagnostics call
 * reports as a JSON parse failure — the wrong diagnosis for the real problem
 * (the plugin half silently never registered its channel).
 *
 * A missing route is exactly the failure this plugin is built to hide: nothing
 * throws, the row stays "active", and the settings page simply cannot talk to
 * the host. Probing the path directly is the only way to see it.
 */
async function routeProbe(port) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/superpowers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: COOKIE ?? '' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'probe', method: 'superpowers', payload: { endpoint: 'diagnostics' } }),
      signal: controller.signal,
    })
    const status = response.status
    if (status === 404) {
      return { present: false, detail: '路由没注册（HTTP 404）：主机侧那条精确通道没进路由表，设置页连不上主机' }
    }
    if (status !== 200) {
      return { present: false, detail: `路由返回 HTTP ${status}，不是预期的 200 响应` }
    }
    return { present: true, detail: '路由已注册，返回 HTTP 200' }
  } catch (error) {
    return { present: false, detail: `探测失败：${error instanceof Error ? error.message : String(error)}` }
  } finally {
    clearTimeout(timer)
  }
}

async function ask(port, endpoint) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/superpowers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: COOKIE ?? '' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'check',
        method: 'superpowers',
        payload: { endpoint },
      }),
      signal: controller.signal,
    })
    const envelope = await response.json()
    if (envelope?.result?.ok !== true) {
      return { unreachable: false, error: envelope?.result?.error?.message ?? 'unknown error' }
    }
    return { unreachable: false, value: envelope.result.value }
  } catch (error) {
    return { unreachable: true, error: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The client-side half cannot be checked from here — it runs in a browser. What
 * this script CAN prove is that the host served the browser bundle at all and
 * that the bundle still carries the pieces the browser half needs. A bundle
 * that is missing, or that no longer contains these symbols, is a build or
 * packaging problem the user would otherwise only notice as a blank panel.
 */
async function bundle(port) {
  try {
    const base = await (await fetch(`http://127.0.0.1:${port}/`, { headers: { cookie: COOKIE ?? '' } })).text()
    // The ROSTER entry id, its served URL path, and the bundle's self-declared
    // module id must all be the package name — the loader row's `name` keys the
    // roster and builds the URL (verified against dsh-client-modules on
    // 2026-09-29), and the loader refuses a bundle whose factory id differs.
    // The package name is read from the manifest beside this script, so a
    // rename cannot desynchronise this check again.
    let pkg = 'dsh-superpowers'
    try {
      const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
      if (typeof manifest.name === 'string') pkg = manifest.name
    } catch {
      // Fall back to the historical name rather than reporting a lie.
    }
    const match = base.match(new RegExp(`"id":"${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}","url":"([^"]*rev=[a-z0-9-]+)"`))
    if (match === null) return { present: false, detail: `名册里找不到 ${pkg}：客户端那一行没装上` }
    // The roster URL is a site-relative path ("plugins/??..."), so it needs a
    // leading slash before it can be joined to the origin. Without one this
    // fetch was asking for ":PORTplugins/" and reporting a missing bundle.
    const path = match[1].startsWith('/') ? match[1] : `/${match[1]}`
    const res = await fetch(`http://127.0.0.1:${port}${path}`)
    if (!res.ok) return { present: false, detail: `浏览器文件取不到（HTTP ${res.status}）` }
    const source = await res.text()
    const missing = ['settings.section', 'conversation.input.left', 'readProjectedModel', 'ensureStyles'].filter(
      (needle) => !source.includes(needle),
    )
    if (missing.length > 0) return { present: false, detail: `浏览器文件缺这些关键部分：${missing.join('、')}` }
    // The loader materializes a row only when the bundle's factory registered
    // under the ROSTER ENTRY ID — the loader row's `name`, which is the package
    // name. A bundle whose self-declared `__ModuleLoader__.load({id})` differs
    // makes the browser refuse the import ("loaded without registering ..."),
    // and the page shows "Failed to load plugins" — while every host check
    // above still passes. This comparison is the only honest signal here.
    const declared = source.match(/__ModuleLoader__\.load\(\{\s*id:\s*['"]([^'"]+)['"]/)?.[1]
    if (declared === undefined) {
      return { present: false, detail: '浏览器文件里找不到 __ModuleLoader__.load({id}) 声明' }
    }
    const normalized = declared.endsWith('/client') ? declared.slice(0, -7) : declared
    if (normalized !== pkg) {
      return {
        present: false,
        detail: `浏览器文件自报模块 id「${declared}」，名册 id 是「${pkg}」，对不上——浏览器会拒绝加载`,
      }
    }
    return { present: true, detail: `浏览器文件已下发（${source.length} 字节），模块 id 与名册一致` }
  } catch (error) {
    return { present: false, detail: `读不到页面：${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * The one preset row that points back at this plugin: `tool-delegate-skill`.
 * A preset mount is WHOLE-TREE — a row that fails to import rolls the whole
 * mount back, and the web client retries without backoff (2026-09-29: ~33
 * full-tree resumes/second, CPU pegged, browser request storm). So this row's
 * importability is worth checking by ACTUALLY importing it the way the loader
 * would: a package specifier resolves from the profile's node_modules, a
 * path imports as-is (which is exactly why a dev-checkout path breaks —
 * peers do not resolve there).
 *
 * `presetFile` overridable so this check can be pointed at the shipped
 * template, or at a known-bad fixture to prove the check still bites.
 */
async function delegateImport(presetFile) {
  try {
    const text = await readFile(presetFile, 'utf8')
    const row = text.match(/^-?\s*- id: tool-delegate-skill\s*\r?\n\s*name:\s*(.+?)\s*$/m)
    if (row === null) {
      return { ok: false, detail: `${presetFile} 里没有 tool-delegate-skill 行` }
    }
    const name = row[1].trim().replace(/^['"]|['"]$/g, '')
    let target = name
    if (!name.startsWith('.') && !name.startsWith('/') && !name.startsWith('file:')) {
      const fromProfile = createRequire(join(homedir(), '.dsh', 'profiles', 'web', 'package.json'))
      target = fromProfile.resolve(name)
    }
    await import(pathToFileURL(target).href)
    return { ok: true, detail: `tool-delegate-skill（${name}）导入正常` }
  } catch (error) {
    return {
      ok: false,
      detail: `tool-delegate-skill 导入失败：${error instanceof Error ? error.message : String(error)}`
        + '。预设挂载会整树回滚、web 端反复重试——这就是挂载风暴的源头。',
    }
  }
}

const port = Number(process.argv[2] ?? DEFAULT_PORT)
try {
  await exchange(port)
} catch (error) {
  console.log(`\n换不到访问凭证：${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(2)
}
const rows = []
let ok = true

const diag = await ask(port, 'diagnostics')
if (diag.unreachable) {
  ok = false
  rows.push(['连接', false, `连不上 ${port} 端口上的 DSH（${diag.error}）。这说明服务没起或端口不对，不是插件坏了。`])
} else if (diag.error !== undefined) {
  ok = false
  const auth = /unauthor|token/i.test(diag.error)
  rows.push([
    '连接',
    false,
    auth
      ? `token 不对（${diag.error}）。重启 DSH 会换新 token，从地址栏重新取。`
      : `主机拒绝了请求：${diag.error}`,
  ])
} else {
  for (const check of diag.value?.checks ?? []) {
    if (check?.ok !== true) ok = false
    rows.push([check?.name ?? '?', check?.ok === true, check?.detail ?? ''])
  }
}

const rp = await routeProbe(port)
if (!rp.present) ok = false
rows.push(['route.exists', rp.present, rp.detail])

const b = await bundle(port)
if (!b.present) ok = false
rows.push(['client.bundle', b.present, b.detail])

const presetFile = process.argv[4] ?? join(homedir(), '.dsh', '.agent-presets', 'superpowers', 'agent.cordis.yml')
const d = await delegateImport(presetFile)
if (!d.ok) ok = false
rows.push(['delegate.import', d.ok, d.detail])

const width = Math.max(...rows.map((r) => r[0].length))
console.log(`\ndsh-superpowers 自检 — 127.0.0.1:${port}\n`)
for (const [name, good, detail] of rows) {
  console.log(`  ${good ? '✓' : '✗'}  ${name.padEnd(width)}  ${detail}`)
}
console.log(
  ok
    ? '\n全部通过。设置页和子会话的模型名应该都在正常工作。\n'
    : '\n有不通过项。上面写了具体是什么坏了、坏在哪一步。\n' +
        '主机侧不会导致 DSH 起不来（那行包了容错），但功能会静默失效——以这里为准。\n',
)
process.exit(ok ? 0 : 1)
