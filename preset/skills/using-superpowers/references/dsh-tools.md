# DeepSeek Harness (DSH) Tool Notes

DSH is the runtime this copy of Superpowers runs on. Like every other
harness note here, the skills themselves are written in actions
("dispatch a subagent", "create a todo", "read a file"). This file
resolves those actions to DSH's tool names.

## Names have no `superpowers:` prefix

DSH skills are invoked by their bare frontmatter name. `superpowers:
brainstorming` is `brainstorming`; `superpowers:test-driven-development`
is `test-driven-development`. Load one with the `skill` tool using that
exact name.

## Action to tool

| Skill says | DSH tool |
|---|---|
| invoke / load a skill | `skill` (exact bare name) |
| dispatch a subagent, skill-bound or not | `delegate_skill` (with or without the skill name) |
| dispatch a subagent that builds on this conversation | `subagent_fork` |
| steer a child, or answer it later | `send_message` |
| cancel a child's current turn | `interrupt_agent` |
| recall which children exist | `list_agents` (`scope: descendants` for the whole tree) |
| create a todo per checklist item | `todo_write` |
| ask a question, preferably with choices | `ask_user_question` |
| present a plan and wait for approval | `exit_plan_mode` |
| keep working autonomously across many turns | `create_goal`, then `update_goal` |
| read / write / edit a file | `read`, `write`, `edit` |
| search files or file contents | `glob`, `grep` |
| run a command | `bash` |
| look something up | `web_search`, `web_fetch` |

## `todo_write` replaces, it does not append

Every call sends the **complete** list and overwrites the previous one.
Sending one new item discards the rest. Keep the whole checklist in each
call, and mark an item `completed` the moment it is done.

## Subagents are continuable and outlive the turn

`subagent` runs in the background by default and immediately returns a
durable id; the child conversation stays available for later turns. When
a child settles, the runtime notifies you — do not poll for it. Children
start on the parent's model unless a route is given, and they inherit
this preset, so they arrive with the same skills already loaded.
`delegate_skill` behaves the same way, except that the model comes from
the settings table instead of the parent's.

`subagent` sees **none** of this conversation: give it a complete,
standalone prompt. `subagent_fork` sees every completed turn so far —
use it for follow-ups that need this context. A subagent spawned to
execute one specific task should ignore the `using-superpowers` skill,
per its `<SUBAGENT-STOP>`.

## Plan mode maps to writing-plans, not brainstorming

Brainstorming's approvals are per-section and conversational, and
`ask_user_question` carries them cleanly — a real run confirmed it: three
design sections, three approvals, no friction, and the section-by-section
split is exactly what that tool is good at. Do **not** enter plan mode for
brainstorming; it is the heavier gate that brainstorming has no use for.

`exit_plan_mode` is the native equivalent of the **writing-plans**
handoff: the complete implementation plan goes through that tool as one
submission, and implementation begins only in a later step after the
user approves.

## What NOT to reach for

`workflow` and `ralph` are deliberately excluded from this mapping. Both
are for explicit user requests only — `workflow` for large fan-out, and
`ralph` only when someone directly asks for a fresh-agent loop. A
normal Superpowers run uses `delegate_skill` and nothing else.

## How to dispatch, and why it is the only way

`delegate_skill` is the only dispatch tool a Superpowers run uses. It
takes a skill name — or none — looks the model up in the
`superpowers-delegation` settings table, and starts the child on that
model. Editing any row in Settings takes effect on the next dispatch,
with no restart and no preset edit.

Omitting the skill name sends the child to the "other subagents" row,
so every subagent in a Superpowers run gets its model from the settings
table. The plain `subagent` tool is the one to avoid: its model is
written into this preset and the user cannot change it from Settings.

**Never dispatch a subagent in the foreground.** A foreground dispatch
creates a ONE-SHOT child: it gets a full execution record but no chat box,
so the user can never open it, steer it, or message it later, and it
carries no model label. Foreground buys you nothing — the outcome arrives
the same way, as a runtime notice back to this session carrying the
child's result and final message. If the next step seems to depend on the
answer, dispatch in the background, end the turn, and let the notice
resume you. The user is watching the child session; a one-shot child is
invisible and useless to them.

## Other harness notes

The remaining `references/*-tools.md` files describe other runtimes and
do not apply here.
