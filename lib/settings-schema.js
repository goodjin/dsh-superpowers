import { z } from './optional-deps.js'

/** The settings namespace owning every delegation-model decision in this preset. */
export const NAMESPACE = 'superpowers-delegation'

/**
 * One exact LLM route. Both halves are required together — a delegation route
 * is meaningless with only one of them — and schemastery treats object keys as
 * optional by default, so both carry an explicit `.required()`.
 */
export const buildRouteSchema = () =>
  z.object({
    provider: z.string().required(),
    model: z.string().required(),
  })

/**
 * The stored shape, as YAML:
 *
 *   superpowers-delegation:
 *     defaultProvider: minimax-cn
 *     defaultModel: MiniMax-M3.1-Flash-Preview
 *     skillModels:
 *       test-driven-development:
 *         provider: xiaomi-token-plan-cn
 *         model: mimo-v2.6-flash
 *
 * The default is FLAT rather than a nested object on purpose: a nested required
 * object fails validation when the key is simply absent, and "absent" is the
 * normal state — it means "no override". Two plain optional strings express it
 * without fighting the schema.
 *
 * "No override" is expressed by the key being ABSENT, not by an explicit null:
 * schemastery has no null type, and an absent key reads the same in YAML.
 */
export const buildDelegationSettingsSchema = () =>
  z.object({
    defaultProvider: z.string(),
    defaultModel: z.string(),
    skillModels: z.dict(buildRouteSchema()),
  })

/**
 * Resolve the effective route for one skill.
 *
 * Written defensively against the STORED shape rather than the parsed one: this
 * also runs while the namespace is unregistered (`undefined`), and against a
 * hand-edited document that skipped validation, so every field is checked
 * before it is used to build a delegation.
 *
 * Precedence: the skill's own pin, then the default pair, then nothing — in
 * which case the caller falls through to the subagent tool's configured route.
 *
 * @param {unknown} settings - the resolved namespace value, possibly undefined
 * @param {string} skill - bare skill name
 * @returns {{provider: string, model: string} | null}
 */
export function resolveRoute(settings, skill) {
  if (settings === null || typeof settings !== 'object') return null
  const record = /** @type {Record<string, any>} */ (settings)
  const pair = (provider, model) =>
    typeof provider === 'string' && provider !== '' && typeof model === 'string' && model !== ''
      ? { provider, model }
      : null

  const pinned = record.skillModels?.[skill]
  if (pinned !== null && typeof pinned === 'object') {
    const route = pair(pinned.provider, pinned.model)
    if (route !== null) return route
  }
  return pair(record.defaultProvider, record.defaultModel)
}
