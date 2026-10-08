import { createRequire } from 'node:module'
import { buildDelegationSettingsSchema, NAMESPACE, unvolatile } from './settings-schema.js'
import { parseYaml } from './optional-deps.js'
import { allRoutes } from './records.js'

/**
 * Host bundle entry: registers the `superpowers-delegation` settings namespace.
 *
 * This row lives in the PROFILE, not in the preset, for one reason: the
 * settings page must be able to open whether or not a superpowers session is
 * running. Only the preset's delegation tool reads the namespace, so a
 * deployment that never mounts the preset still shows and can edit the table
 * without any tool acting on it.
 *
 * Registering a namespace does NOT publish a Cordis Service — it hands back an
 * owner scope from the host `settings` service — so this row needs no
 * `isolate` realm, and every session on every preset can resolve the value
 * through `ctx.settings.get(NAMESPACE)`.
 */
export const name = 'superpowers-delegation-settings'

/**
 * This row takes no configuration of its own: the whole table lives in the
 * user's settings document, which is what the settings page writes to. The
 * registered base is therefore the schema's own empty value, and a deployment
 * that never opens the settings page still reads `{}` and falls through to the
 * subagent tool's configured route.
 *
 * There is deliberately no `Config` export here. An earlier revision had one,
 * built from `RouteSchema.nullable()` and `z.record()` — neither exists in this
 * schemastery — and it threw at PROCESS START, taking the whole web server
 * down. Anything this row derives from `DelegationSettingsSchema` would have
 * to be derived the same way, so keeping the row configuration-free is what
 * makes the two impossible to drift apart.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
/**
 * Execute one browser request against the delegation settings.
 *
 * Everything crossing this boundary is lossless JSON in both directions: the
 * request names an endpoint and hands it a payload, and the handler returns
 * plain data or throws.
 *
 * @param {any} connCtx - a context carrying `settings`, `configEditor` and the LLM registry
 * @param {any} payload - `{endpoint, value?}` from the browser
 * @returns {Promise<any>}
 */
async function dispatch(connCtx, payload) {
  const endpoint = payload?.endpoint
  switch (endpoint) {
    case 'delegation.read':
      return readDelegation(connCtx) ?? {}
    case 'delegation.write': {
      // Writes go through the settings service, which owns the schema
      // validation AND the persistence into the profile patch's loader row.
      // Merging onto the current value keeps a partial write from dropping the
      // half it did not mention. The row id is the namespace name.
      const settings = connCtx.get('settings')
      if (settings === undefined || typeof settings.update !== 'function') {
        throw new Error('settings service is unavailable: cannot write delegation routes')
      }
      await settings.update(NAMESPACE, payload.value ?? {})
      return readDelegation(connCtx) ?? {}
    }
    case 'childModels':
      // Every route this preset has delegated, keyed by child session id.
      // Children started by any other path are simply absent, which the client
      // renders exactly as it renders today's state — nothing, not a wrong value.
      return allRoutes()
    case 'modelOptions':
      return modelOptions(connCtx)
    case 'diagnostics':
      return diagnostics(connCtx)
    default:
      throw new Error(`superpowers: unknown endpoint ${JSON.stringify(endpoint)}`)
  }
}

/**
 * Read the delegation config from this plugin's own loader row.
 *
 * Under 0.2.x the value lives on the row's `Config` (projected into the profile
 * patch) and parses into a volatile reference, so it is unwrapped here. Reads
 * go through `configEditor` — the one service that can see other rows' config —
 * because this is the HOST row reading its OWN namespace by id.
 *
 * @param {any} ctx - a context carrying `configEditor`
 * @returns {any} the plain config, or undefined
 */
function readDelegation(ctx) {
  const editor = ctx.get('configEditor')
  if (editor === undefined || typeof editor.entries !== 'function') return undefined
  const entry = editor.entries().find((row) => row.options?.id === NAMESPACE)
  return entry === undefined ? undefined : unvolatile(entry.fiber?.config)
}

/**
 * Report whether every host-side piece this plugin depends on is still present.
 *
 * This exists because the plugin's characteristic failure mode is SILENT. The
 * pieces below are internal DSH implementation — a settings registration
 * signature, a fetch-route registry, an LLM registry under one of two names.
 * When a DSH upgrade moves any of them, nothing throws: the row still loads,
 * the server still boots, and the feature simply stops existing. A user has no
 * way to tell "the model I set is being ignored" from "the model I set was never
 * read".
 *
 * So the checks are reported rather than enforced. Every probe is written to
 * survive its own absence, and a probe that cannot run reports `unavailable`
 * instead of throwing — a diagnostic that crashes is worse than no diagnostic.
 *
 * @param {any} connCtx - a context carrying `settings`, `configEditor` and the LLM registry
 * @returns {Promise<{ok: boolean, checks: Array<{name: string, ok: boolean, detail: string}>}>}
 */
async function diagnostics(connCtx) {
  const checks = []
  const add = (name, ok, detail) => checks.push({ name, ok, detail })

  const settings = connCtx.get('settings')
  add(
    'settings.update',
    typeof settings?.update === 'function',
    typeof settings?.update === 'function'
      ? 'settings 服务可用，可写入 delegation 路由'
      : 'settings 服务缺 update()：设置页写不进去，DSH 接口又变了',
  )

  const editor = connCtx.get('configEditor')
  add(
    'config.row',
    editor !== undefined && typeof editor.entries === 'function',
    editor === undefined || typeof editor.entries !== 'function'
      ? 'configEditor 不可用：读不到本插件那行的配置'
      : '可按行 id 读配置',
  )

  let readOk = false
  let readDetail = '未知'
  try {
    const value = readDelegation(connCtx)
    const plain = unvolatile(value)
    readOk = plain !== undefined && typeof plain === 'object'
    readDetail = readOk
      ? `当前 ${Object.keys(plain.skillModels ?? {}).length} 个技能已固定模型`
      : '尚未配置（正常，意味着全部走默认路由）'
  } catch (error) {
    readDetail = `读取失败：${error instanceof Error ? error.message : String(error)}`
  }
  add('config.read', readOk, readDetail)

  const registry = connCtx.get('llm') ?? connCtx.get('llmRouter')
  const hasRegistry = typeof registry?.listProviders === 'function' && typeof registry.listModels === 'function'
  add(
    'llm.registry',
    hasRegistry,
    hasRegistry
      ? `${registry.listProviders().length} 个 provider 可选`
      : '找不到 LLM 注册表（llm / llmRouter）：模型下拉会是空的，但不影响已保存的配置',
  )

  const options = await modelOptions(connCtx)
  add('llm.models', options.length > 0, `可选模型 ${options.length} 条`)

  add(
    'connection.route',
    typeof connCtx.connection?.registerFetchRoute === 'function',
    typeof connCtx.connection?.registerFetchRoute === 'function'
      ? '已注册'
      : '浏览器通道注册入口没了：设置页和输入框的模型名都会失效',
  )

  return { ok: checks.every((c) => c.ok), checks }
}

/**
 * Every selectable route, read from the Host's own LLM registry.
 *
 * The browser cannot enumerate providers itself — the registry is a process
 * singleton with no client projection — so the settings page asks for the list
 * rather than hard-coding one that would rot on the first model rename.
 *
 * Both the service name and the field names are probed rather than assumed: a
 * deployment that mounts a different LLM row gets an empty dropdown instead of
 * a boot failure, which matters because this whole file is the one row that
 * decides whether DSH starts.
 *
 * @param {any} connCtx - a context carrying the LLM registry
 * @returns {Promise<Array<{provider: string, model: string}>>}
 */
async function modelOptions(connCtx) {
  const registry = connCtx.get('llm') ?? connCtx.get('llmRouter')
  if (typeof registry?.listProviders !== 'function' || typeof registry.listModels !== 'function') {
    return []
  }
  const idOf = (value) => (typeof value?.id === 'string' ? value.id : value?.name)
  const options = []
  for (const provider of registry.listProviders()) {
    const providerId = idOf(provider)
    if (typeof providerId !== 'string') continue
    let models
    try {
      models = await registry.listModels(providerId)
    } catch {
      // One unreachable provider must not empty the whole dropdown.
      continue
    }
    for (const model of models ?? []) {
      const modelId = idOf(model)
      if (typeof modelId === 'string') options.push({ provider: providerId, model: modelId })
    }
  }
  return options
}

/**
 * The plugin's `Config`, projected by DSH into the settings page and into the
 * profile patch's loader row.
 *
 * Built HERE inside a try rather than at module top level: a schema constructor
 * that a future DSH upgrade made unconstructible would otherwise throw before
 * `apply` is ever entered — and nothing in this file could catch that, because
 * it is a module-evaluation throw, not a plugin throw. The original incident
 * was exactly this: `RouteSchema.nullable` stopped being a function and the
 * whole web server went down at start. `undefined` just means the loader skips
 * validation.
 */
export const Config = (() => {
  try {
    return buildDelegationSettingsSchema()
  } catch {
    return undefined
  }
})()

/**
 * Carry the old `settings.yaml` delegation section into this row's `Config`.
 *
 * DSH 0.2.x stores plugin config in the profile patch's loader row, and the
 * legacy importer has no mapping for `superpowers-delegation` — so without this
 * the routes a user already set would silently vanish. Idempotent by design: it
 * only writes when the row has NO config yet, so a later hand-edit is never
 * overwritten, and a repeat boot does nothing.
 *
 * Failures are logged and swallowed: a migration problem must not stop the
 * server from starting, and the settings page still works without it.
 *
 * @param {any} ctx - a context carrying `settings` and `configEditor`
 */
async function migrateLegacySettings(ctx) {
  try {
    const editor = ctx.get('configEditor')
    const settings = ctx.get('settings')
    if (editor === undefined || typeof editor.entries !== 'function') return
    const entry = editor.entries().find((row) => row.options?.id === NAMESPACE)
    if (entry === undefined) return

    const legacy = readLegacySettingsYaml()
    if (legacy === undefined) return

    // Merge rather than replace, and only fill what is missing: an empty string
    // counts as "not set", so a stray write cannot permanently block the
    // migration. A skill the user pinned later is never overwritten.
    const current = unvolatile(entry.fiber?.config) ?? {}
    const isEmpty = (v) => v === undefined || v === null || v === ''

    const missing = {}
    if (isEmpty(current.defaultProvider) && !isEmpty(legacy.defaultProvider)) {
      missing.defaultProvider = legacy.defaultProvider
    }
    if (isEmpty(current.defaultModel) && !isEmpty(legacy.defaultModel)) {
      missing.defaultModel = legacy.defaultModel
    }
    const currentSkills = unvolatile(current.skillModels) ?? {}
    const legacySkills = unvolatile(legacy.skillModels) ?? {}
    const addedSkills = {}
    for (const [skill, route] of Object.entries(legacySkills)) {
      if (currentSkills[skill] === undefined) addedSkills[skill] = route
    }
    if (Object.keys(addedSkills).length > 0) missing.skillModels = addedSkills

    if (Object.keys(missing).length === 0) return
    if (settings === undefined || typeof settings.update !== 'function') return
    await settings.update(NAMESPACE, missing)
    ctx.logger?.info?.(
      '[superpowers-delegation] migrated legacy settings.yaml routes into '
      + NAMESPACE + ': ' + Object.keys(missing).join(', '),
    )
  } catch (error) {
    ctx.logger?.warn?.('[superpowers-delegation] legacy settings migration failed: ' + String(error))
  }
}

/**
 * Read the legacy `superpowers-delegation` section from `settings.yaml`.
 *
 * DSH renames the file to `settings.yaml.imported` once it has consumed it, so
 * both are checked. Returns `undefined` when there is nothing to migrate —
 * which is the normal state after the first boot.
 *
 * @returns {any} the section's values, or undefined
 */
function readLegacySettingsYaml() {
  try {
    const home = typeof process.env.HOME === 'string' ? process.env.HOME : undefined
    if (home === undefined) return undefined
    const require = createRequire(import.meta.url)
    const { existsSync, readFileSync } = require('node:fs')
    const { join } = require('node:path')
    for (const name of ['settings.yaml.imported', 'settings.yaml']) {
      const path = join(home, '.dsh', name)
      if (!existsSync(path)) continue
      const doc = parseYaml(readFileSync(path, 'utf8'))
      const section = doc?.['superpowers-delegation']
      if (section !== null && typeof section === 'object' && Object.keys(section).length > 0) {
        return section
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

export function apply(ctx) {
  // This row runs at PROCESS START, inside the composition the whole server is
  // built from. A throw here is not a plugin failure — it is a server that
  // never starts, taking every preset and every unrelated session with it.
  //
  // DSH offers no per-row "non-fatal" flag (an entry row can carry only id,
  // name, config, group, disabled, inject), so the tolerance has to live here.
  // Anything that escapes this catch is something a later DSH upgrade could
  // introduce: a renamed service, a changed settings signature, a dependency
  // that stopped resolving.
  //
  // The tradeoff is deliberate. Failing loudly would be more correct for this
  // one row, but being wrong that way costs a machine that will not boot — and
  // a broken bundle cannot be repaired by a bundle that never loaded. Swallowing
  // degrades superpowers to "no per-skill pins; delegate_skill falls through to
  // the inherited route": visibly degraded, fully recoverable, and logged
  // loudly enough that it does not stay hidden.
  try {
    // ONE injection for both services. Nesting a second ctx.inject on the
    // derived context a service injection hands back never fires on current
    // Cordis — the route was simply never registered and nothing reported it.
    // See AGENTS.md.
    ctx.inject(['settings', 'connection'], (settingsCtx) => {
      // The namespace is NOT registered here: under 0.2.x it is projected from
      // this row's `Config` export, and the namespace name is this row's id.
      // Migrate anything stored under the old settings.yaml section first.
      migrateLegacySettings(settingsCtx)

      // The browser half of this plugin reaches the host over this channel.
      //
      // It is deliberately NOT the Remote/typert mechanism: those endpoints are
      // declared by a build-time codegen pass that emits a `__esDecorate`
      // helper, so a hand-written package cannot declare one. `connection` is
      // the carrier-neutral RPC every feature package can register against
      // without codegen — `connection.register(owner, channel, handler)` on the
      // Host, `connection.rpc.call(channel, endpoint, payload)` in the browser.
      //
      // The channel is injected rather than required, because `connection` only
      // exists where a browser is actually served. A headless deployment skips
      // this block instead of failing the row.
      // 'connection' is injected in the SAME call as 'settings', not nested
      // inside this callback. A nested ctx.inject on the derived context a service
      // injection hands back never fires on current Cordis — the exact route is
      // simply never registered and nothing reports it. See AGENTS.md.
      // A headless deployment has no browser to serve: skip the channel rather
      // than fail the row.
      if (typeof settingsCtx.connection?.registerFetchRoute !== 'function') return

        // Reaching the Host from the browser happens over the shared `/api`
        // channel. Two APIs can serve it and only one of them is open here:
        //
        //   - `rpc.intercept('/api', matches, handler)` holds a SINGLE slot that
        //     the Typert Gateway already claims for its generated Remote
        //     endpoints, so registering throws and is swallowed with the rest of
        //     this row's damage control.
        //   - `fetch.register({ path, methods, requestBody, fetch })` is an
        //     EXACT route, and the route table is consulted BEFORE the gateway
        //     fallback. That is the slot that is actually free.
        //
        // `register` — the third option, mounting a private channel prefix — is
        // unusable on a web deployment: the static asset handler owns that
        // catch-all prefix first and answers every POST to it with 405.
        //
        // So the browser calls `rpc.call('/api', 'superpowers', { endpoint,
        // payload })` and this one exact route decodes the envelope itself.
        // Envelope decoding mirrors the Gateway's own wire contract: the same
        // `{type,rpcId,method,payload}` request and `{type,rpcId,result}` reply,
        // because the client-side `rpc.call` validates both halves itself.
        settingsCtx.effect(
          () => settingsCtx.connection.registerFetchRoute(settingsCtx, {
            path: '/api/superpowers',
            methods: ['POST'],
            requestBody: 'buffered',
            fetch: async (request) => {
              let message
              try {
                message = await request.json()
              } catch {
                return new Response('body is not JSON', { status: 400 })
              }
              if (typeof message !== 'object' || message === null || typeof message.rpcId !== 'string') {
                return new Response('invalid envelope', { status: 400 })
              }
              const fail = (code, detail) => new Response(JSON.stringify({
                type: 'server-response',
                rpcId: message.rpcId,
                result: { ok: false, error: { code, message: detail, details: { issues: [] } } },
              }), { status: 200, headers: { 'content-type': 'application/json' } })
              try {
                return new Response(JSON.stringify({
                  type: 'server-response',
                  rpcId: message.rpcId,
                  result: { ok: true, value: await dispatch(settingsCtx, message.payload) },
                }), { status: 200, headers: { 'content-type': 'application/json' } })
              } catch (error) {
                return fail('superpowers/handler-failed', String(error))
              }
            },
          }),
          'superpowers: /api/superpowers route',
        )
    })
  } catch (error) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
    console.error(
      `[superpowers-delegation] settings namespace "${NAMESPACE}" was NOT registered; DSH started `
      + 'anyway and superpowers falls back to the inherited subagent route.\n'
      + `Repair the plugin, or drop "@goodjin/dsh-superpowers" from the profile bundles to silence this.\n${detail}`,
    )
  }
}

