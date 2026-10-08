# dsh-superpowers

Run [Superpowers](https://github.com/obra/superpowers) — spec-driven development — as a
DeepSeek Harness agent preset, with **a different subagent model for every skill**,
chosen from a Settings page.

The problem it solves: Superpowers is a heavily skill-based methodology, but in a
default harness every subagent runs on whatever model the parent is using. Running
`systematic-debugging` on a big model and `writing-good-tests` on a cheap one is the
obvious thing to want, and there is no first-class way to get it.

## What you get

| | |
|---|---|
| **A preset, not just a plugin** | Ships the 15 Superpowers skills and the persona that makes the agent actually follow the six-phase method |
| **Per-skill model settings** | A Superpowers section in Settings: one dropdown per skill, plus a row for subagents that aren't bound to a skill |
| **One dispatch tool** | `delegate_skill` — reads the table, starts the child on that model, names the child session after the skill |
| **The model is visible** | A subagent's composer shows which model it is actually running on, read-only |
| **It cannot break your install** | The host row is fault-tolerant by construction; DSH starts and stays usable even if this plugin fails entirely |

## Install

Two halves, two steps. The **plugin** is global — Settings section, model
table, tool module, self-check. The **preset** is the selectable mode —
skills, persona, tool rows. Installing the package does not create the mode;
the preset has to be copied into place.

From GitHub (the package is not on npm — install straight from the repository):

```sh
dsh plugin --profile web add goodjin/dsh-superpowers
```

Then copy the preset, which is what makes **Superpowers** appear in the
preset selector:

```sh
mkdir -p ~/.dsh/.agent-presets/superpowers
cp -R ~/.dsh/profiles/web/node_modules/@goodjin/dsh-superpowers/preset/. ~/.dsh/.agent-presets/superpowers/
```

In `~/.dsh/settings.yaml`:

```yaml
agent-presets:
  default: superpowers
```

To add it without making it the default, pick **Superpowers** from the preset
selector in the UI.

### Upgrading

Re-running the install command updates the **plugin half only**. The preset
under `~/.dsh/.agent-presets/superpowers/` is a snapshot you copied — it does
not follow package upgrades, so after reinstalling, re-run the `cp -R` line
above to refresh it. Re-copying overwrites hand edits in that directory; if
you customised the preset, keep your version under a different name.

## Configure

Open **Settings → Superpowers**. Each row is one skill; the last row covers
subagents dispatched without a skill. Choices are read on the next dispatch — no
restart, no preset edit.

Routes are stored in the profile patch's `superpowers-delegation-settings`
loader row (DSH 0.2.x keeps plugin config there, not in `settings.yaml`), so you
can also edit them by hand in `cordis.patch.yml`:

```yaml
- id: superpowers-delegation-settings
  name: "@goodjin/dsh-superpowers"
  config:
    defaultProvider: minimax-cn
    defaultModel: MiniMax-M3.1-Flash-Preview
    skillModels:
      verification-before-completion:
        provider: xiaomi-token-plan-cn
        model: mimo-v2.6-pro
```

Values set in `settings.yaml` before upgrading are migrated automatically on
first boot — the migration only fills fields you have not already set, so it
never overwrites a later hand-edit.

Resolution order per skill: the skill's own pin, then the default pair, then
nothing — in which case the child inherits the parent's route.

## Verifying an install

```sh
node ~/.dsh/profiles/web/node_modules/@goodjin/dsh-superpowers/scripts/check.mjs 3080 <token>
```

The token is in the URL you opened DSH with; it changes on every restart. The
check reports each host-side dependency this plugin has, individually. After a
DSH upgrade, run it first — see below.

The key line is `route.exists`: it POSTs the browser channel directly. When the
host half silently failed to register its route (the bug fixed in v0.2.1), the
row stayed "active", nothing logged anything, and only this probe could see the
404. Do not skip it.

## Upgrades and compatibility

DSH has no per-plugin version pinning: the plugin is resolved from the profile at
start. A DSH upgrade that moves an internal API produces **no error** — the server
boots and this feature quietly stops working. That is the failure mode this plugin
was built to survive rather than to prevent.

**Supported DSH versions:** `>=0.1.5-rc.2 <0.3.0` (declared in `peerDependencies`
as `@deepseek-ai/dsh-tools`). Outside that range the Desktop plugin panel marks
the plugin incompatible and blocks activation — that gate is the only signal this
plugin gets when DSH moves under it.

- **The host row is wrapped so it cannot stop DSH from starting.** Verified by
  fault injection: with the row throwing, DSH boots and all 54 client entries
  still mount. The plugin degrades to "no per-skill pins".
- **The settings page shows a self-check line at the top of the Superpowers
  section** — green when every dependency is where the plugin expects it, red with
  a per-item explanation when not.
- **Client-side failures are isolated per entry** by the host's plugin loader, so a
  broken client half shows a banner and leaves the rest of the UI working.

If the check reports a failure, the item name tells you which dependency moved.

## Layout

| Path | |
|---|---|
| `lib/index.js` | Host row: settings namespace, the browser channel, the self-check endpoint |
| `lib/client.js` | Browser row: the Settings section, the composer model label |
| `lib/skill-delegation.js` | The `delegate_skill` tool |
| `lib/settings-schema.js` | The stored settings shape and route resolution |
| `cordis.patch.yml` | The two composition rows this plugin adds |
| `preset/` | The agent preset and the 15 Superpowers skills |
| `scripts/check.mjs` | Post-upgrade compatibility check |
| `scripts/test.mjs` | Load-safety and degradation tests, run in the checkout and against the installed copy |

## License

MIT — see [LICENSE](LICENSE). The bundled skills are from
[obra/superpowers](https://github.com/obra/superpowers), also MIT; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
