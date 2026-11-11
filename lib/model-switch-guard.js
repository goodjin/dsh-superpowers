import { randomUUID } from 'node:crypto'

/**
 * Model-switch compaction guard (host-side preset row).
 *
 * WHY THIS EXISTS
 * ---------------
 * The host's compaction-basic plugin registers an `agent/request` waterfall
 * hook that, on a provider/model change, compacts the existing history FIRST.
 * If that compaction fails (e.g. the summary request goes to a model whose
 * quota is exhausted — the 2026-11-11 MiniMax 429 incident), it throws
 * MODEL_SWITCH_COMPACTION_FAILED and the WHOLE switch is rejected; the
 * previous request model is preserved. Retrying with any other model repeats
 * the same failure, so the user sees "I switched but it still fails".
 *
 * Two other compaction triggers (step pressure, context-overflow recovery)
 * already degrade to a warning on failure. This row gives the model-switch
 * trigger the same behaviour: warn, show a visible in-session notice, and let
 * the switch proceed. No host files are modified.
 *
 * HOW IT WRAPS THE HOST HOOK (ordering is the whole trick)
 * ------------------------------------------------------
 * `agent/request` is an agent-scoped waterfall: listeners run outermost-first,
 * and `prepend: true` inserts a listener at the FRONT of the chain. The host's
 * compaction hook is itself prepend-registered. So this row must register
 * AFTER compaction to end up OUTSIDE it and be able to catch its throw.
 *
 * Declaration order alone does NOT guarantee that: the loader activates preset
 * rows concurrently (`Promise.all`). The deterministic guarantee is
 * `inject: ['compaction']` — the compaction engine registers itself as the
 * `compaction` service, so Cordis does not initialize this row until that
 * service (and therefore its hooks) is fully installed. The row also lives
 * INSIDE the compaction group's config list so it shares the same isolated
 * realm and the same `compaction` service instance.
 *
 * This module is intentionally dependency-free at top level: a failed import
 * here would roll back the entire preset tree (a whole-tree transaction) and
 * cause a resume storm. apply() must never throw — see the catch below.
 */

export const name = 'superpowers-model-switch-guard'

/** Cordis waits for the compaction service before initializing this row. */
export const inject = ['compaction']

export const MODEL_SWITCH_COMPACTION_FAILED = 'MODEL_SWITCH_COMPACTION_FAILED'

/**
 * Build the config the failed switch was trying to use.
 *
 * The failing host hook calls `next()` first (which produces the target config)
 * and then compacts; when compaction throws, the config never comes back out.
 * The agent's recorded selection IS the target route, and the previous request
 * header holds the controls (maxTokens, reasoningEffort, …) that the loop
 * carries across a switch. Rebuilding here is enough for the loop's own check
 * (`proposedConfig.provider/model === selection.provider/model`) to pass.
 *
 * @param {any} agent - fused into every agent/request payload by the host
 * @returns {object|undefined} the target config, or undefined if unavailable
 */
export function fallbackConfig(agent) {
  const selection = agent?.model?.current?.()
  if (!selection || typeof selection.provider !== 'string' || typeof selection.model !== 'string') return undefined
  const previous = agent?.session?.requestHeader?.()?.config
  const config = { ...(previous && typeof previous === 'object' ? previous : {}) }
  delete config.provider
  delete config.model
  return { ...config, ...selection }
}

/**
 * Build one durable, model-visible notice. Shape matches the host's own
 * model-selection notice (createUserMessage): role/content/id plus a
 * `source.kind` the conversation UI renders as a system-ish notice.
 *
 * @param {any} error - the swallowed failure
 * @returns {object} a complete user/message data object
 */
export function switchNotice(error) {
  const detail = error instanceof Error ? error.message : String(error)
  const summary = `上下文压缩失败，已跳过并继续切换模型：${detail}`
  return {
    content: [{ type: 'text', text: summary }],
    source: {
      kind: 'model-selection',
      form: 'notice',
      summary: summary.length <= 120 ? summary : `${summary.slice(0, 119)}…`,
    },
    role: 'user',
    id: randomUUID(),
  }
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  try {
    ctx.on('agent/request', async (payload, next) => {
      let config
      try {
        config = await next()
        return config
      } catch (error) {
        const signal = payload?.signal
        const isSwitchFailure = error instanceof Error
          && error.code === MODEL_SWITCH_COMPACTION_FAILED
        if (!isSwitchFailure || signal?.aborted === true) throw error

        const fallback = fallbackConfig(payload?.agent)
        if (fallback === undefined) throw error

        const message = error instanceof Error ? error.message : String(error)
        try {
          ctx.logger.warn(`model-switch compaction failed: ${message}; continuing the switch without compaction`)
        } catch {
          // A broken logger must not undo the switch.
        }
        try {
          payload.agent?.session?.append?.('user/message', switchNotice(error), { surfaceOp: 'append' })
        } catch (appendError) {
          try {
            ctx.logger.warn(`model-switch guard: could not append the visible notice: ${String(appendError)}`)
          } catch {}
        }
        return fallback
      }
    }, { prepend: true })
  } catch (error) {
    // Registration itself failed (inactive context, missing events service).
    // Swallow it: this row is a best-effort guard, not a load-bearing one.
    // A throw here would roll back the whole preset tree.
    try {
      ctx?.logger?.warn?.(`model-switch guard: hook registration failed: ${String(error)}`)
    } catch {}
  }
}
