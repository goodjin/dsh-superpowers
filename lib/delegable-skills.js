/**
 * Canonical Superpowers skill ids (one folder per skill under preset/skills/).
 * Keep lib/client.js SKILLS in sync — the browser bundle cannot import this module.
 */
export const DELEGABLE_SKILLS = [
  'brainstorming',
  'diagnosing-superpowers',
  'dispatching-parallel-agents',
  'executing-plans',
  'finishing-a-development-branch',
  'receiving-code-review',
  'requesting-code-review',
  'subagent-driven-development',
  'systematic-debugging',
  'test-driven-development',
  'using-git-worktrees',
  'using-superpowers',
  'verification-before-completion',
  'writing-plans',
  'writing-skills',
]

/** Stored on both provider and model when Settings picks「复用主会话模型」. */
export const ROUTE_USE_PARENT_SESSION = '__sp_use_parent_session__'

/**
 * @param {unknown} route
 * @returns {boolean}
 */
export function isUseParentSessionRoute(route) {
  if (route === null || typeof route !== 'object') return false
  const record = /** @type {{provider?: unknown, model?: unknown}} */ (route)
  return record.provider === ROUTE_USE_PARENT_SESSION && record.model === ROUTE_USE_PARENT_SESSION
}
