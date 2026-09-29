/**
 * Peer dependencies without load-time risk.
 *
 * A preset mount is whole-tree: if this package fails to IMPORT, every sibling
 * row is rolled back and the web client retries without backoff — that is how
 * one unresolvable row became a resume storm (2026-09-29). So nothing at the
 * top level of the entry modules may be able to fail, and the only fragile
 * things there were these two libraries. They are imported through this
 * wrapper, which absorbs failure: the real library when it is installed, a
 * permissive stub (or plain absence) when it is not. Callers degrade instead
 * of dying at load.
 *
 * Loaded eagerly rather than at first use on purpose: apply() registers the
 * tool synchronously and the session snapshots its tool list right after the
 * mount — a registration that landed later would silently miss the session.
 */

async function soft(name) {
  try {
    return await import(name)
  } catch {
    return null
  }
}

const [schemastery, dshTools] = await Promise.all([
  soft('@deepseek-ai/schemastery'),
  soft('@deepseek-ai/dsh-tools'),
])

/** A schema that validates nothing and returns the value unchanged. */
function stubSchema() {
  const schema = (value) => value
  schema.default = () => schema
  schema.required = () => schema
  schema.optional = () => schema
  return schema
}

const stubZ = {
  object: () => stubSchema(),
  string: () => stubSchema(),
  array: () => stubSchema(),
  dict: () => stubSchema(),
}

/** Schemastery when it is installed; a no-op stand-in when it is not. */
export const z = (schemastery?.default ?? schemastery) ?? stubZ

/** Real tool factory when dsh-tools is installed; `null` tells apply() to degrade. */
export const defineTool = dshTools?.defineTool ?? null
