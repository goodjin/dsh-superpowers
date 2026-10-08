import { z, isVolatile } from './optional-deps.js'

/**
 * The loader row id this plugin's settings namespace is known by.
 *
 * Under DSH 0.2.x a settings namespace is NOT registered by the plugin — it is
 * projected from the loader row's `Config` schema, and the namespace name is
 * the ROW'S ID, not anything the plugin chooses. This row id is therefore the
 * one name that has to stay stable: renaming it silently orphans every stored
 * value. See AGENTS.md.
 */
export const NAMESPACE = 'superpowers-delegation-settings'

/**
 * One exact LLM route. Both halves are required together — a delegation route
 * is meaningless with only one of them — and schemastery treats object keys as
 * optional by default, so both carry an explicit `.required()`.
 *
 * Deliberately NOT marked volatile: a volatile field may not sit inside another
 * volatile field, and `skillModels` below is the editable one. The route's own
 * fields are edited through it, not on their own.
 */
export const buildRouteSchema = () =>
  z.object({
    provider: z.string().required(),
    model: z.string().required(),
  })

/**
 * The plugin's `Config`, which DSH projects into the settings page and into the
 * profile patch's loader-row `config`.
 *
 * Two rules of the 0.2.x config system shape this schema:
 *
 *   - **Only `volatile()` fields are editable from Settings.** `settings.update`
 *     rejects any path beneath a non-volatile node ("Config field ... is not
 *     volatile"), so anything the settings page writes has to be marked.
 *   - **A volatile field may not sit inside another volatile field** — the path
 *     must be fixed. So each editable field is marked once, at its own level.
 *
 * Values land in the profile patch's loader row `config`, not in `settings.yaml`.
 * Migration from the old `settings.yaml` section is done in `apply()`.
 *
 * The stored shape:
 *
 *   defaultProvider: minimax-cn
 *   defaultModel: MiniMax-M3.1-Flash-Preview
 *   skillModels:
 *     test-driven-development:
 *       provider: xiaomi-token-plan-cn
 *       model: mimo-v2.6-flash
 */
export const buildDelegationSettingsSchema = () =>
  z.object({
    defaultProvider: z.string().volatile(),
    defaultModel: z.string().volatile(),
    skillModels: z.dict(buildRouteSchema()).volatile(),
  }).default({})

/**
 * Unwrap volatile references, recursively.
 *
 * Volatile config values parse into a stable reference read with `.get()`
 * (cosmokit's `write` protocol marks them). Every FIELD is its own reference —
 * not just the object holding them — so unwrapping has to walk the whole shape.
 * Unwrapping only the top level leaves `{}` behind for a field the user clearly
 * set, which reads as "not configured" and silently loses the routes.
 *
 * Done in ONE place instead of at each call site: a reader that forgets would
 * silently see `undefined` for a field the user clearly set.
 *
 * @param {unknown} value - a config value, plain or volatile, at any depth
 * @returns {unknown} the plain value
 */
export function unvolatile(value) {
  if (isVolatile(value)) return unvolatile(value.get())
  if (Array.isArray(value)) return value.map(unvolatile)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, unvolatile(child)]))
  }
  return value
}

/**
 * Resolve the effective route for one skill.
 *
 * Written defensively against the STORED shape rather than the parsed one: this
 * also runs against a hand-edited document that skipped validation, so every
 * field is checked before it is used to build a delegation.
 *
 * Precedence: the skill's own pin, then the default pair, then nothing — in
 * which case the caller falls through to the subagent tool's configured route.
 *
 * @param {unknown} settings - the resolved config, possibly volatile, possibly undefined
 * @param {string | null} skill - bare skill name, or null for the "other subagents" row
 * @returns {{provider: string, model: string} | null}
 */
export function resolveRoute(settings, skill) {
  const plain = unvolatile(settings)
  if (plain === null || typeof plain !== 'object') return null
  const record = /** @type {Record<string, any>} */ (plain)
  const pair = (provider, model) =>
    typeof provider === 'string' && provider !== '' && typeof model === 'string' && model !== ''
      ? { provider, model }
      : null

  if (skill !== null && skill !== undefined) {
    const skillModels = unvolatile(record.skillModels) ?? {}
    const pinned = unvolatile(skillModels[skill])
    if (pinned !== null && typeof pinned === 'object') {
      const route = pair(pinned.provider, pinned.model)
      if (route !== null) return route
    }
  }
  return pair(record.defaultProvider, record.defaultModel)
}
