/**
 * Host-side ledger of the route each delegated child actually runs on.
 *
 * Why this exists rather than a lookup: DSH freezes a child's provider/model
 * into its continuation descriptor, but that descriptor is only reachable
 * while the continuation manager holds it live. Nothing durable carries the
 * model — the `subagent` identity projection stores `{mode,label,seq}`, the
 * catalog event stores `{childId,childCreatedAt,mode,label}`, and there is no
 * public host method that reads a child's frozen route back. That is precisely
 * why the browser cannot show a model today.
 *
 * So the plugin records the route at the moment it knows it for certain — the
 * instant `startContinuable` returns a child id — and the browser asks for the
 * result. The ledger is bounded by the number of delegations a process makes
 * and is keyed by an opaque session id, so it holds nothing a caller could not
 * already see by looking at that session.
 *
 * The limitation is deliberate and worth stating: only children this preset
 * delegates are recorded. A child started through a different tool path has no
 * ledger entry, and the browser shows nothing for it — exactly the behaviour
 * that exists today, not a wrong value.
 */

/** @type {Map<string, {provider: string, model: string}>} */
const routes = new Map()

/**
 * Record the route a child was just started on.
 * @param {string} childId - durable child session id
 * @param {{provider: string, model: string} | null} route - the pinned route, or null when the child inherits
 * @returns {void}
 */
export function recordRoute(childId, route) {
  if (typeof childId !== 'string' || childId === '') return
  if (route === null) {
    routes.delete(childId)
    return
  }
  routes.set(childId, { provider: route.provider, model: route.model })
}

/**
 * Read every recorded route, keyed by child id.
 * @returns {Record<string, {provider: string, model: string}>}
 */
export function allRoutes() {
  return Object.fromEntries(routes)
}

/**
 * Drop a child's record, called when a session closes so the ledger cannot
 * outlive the conversation it describes.
 * @param {string} childId - durable child session id
 * @returns {void}
 */
export function forgetRoute(childId) {
  routes.delete(childId)
}
