# Third-party notices

## Superpowers skills and methodology

`preset/skills/` contains the Superpowers skills — the spec-driven development
methodology this plugin is built around. They are redistributed here from:

- **Upstream:** https://github.com/obra/superpowers
- **Copyright:** Copyright (c) 2025 Jesse Vincent
- **License:** MIT

The upstream MIT license text is reproduced verbatim at
`preset/skills/LICENSE.upstream`.

Redistribution is permitted under MIT provided the copyright notice and
permission notice accompany the material, which is why that file is kept next
to the skills rather than at the repository root.

### What was changed here

- `preset/skills/using-superpowers/references/dsh-tools.md` was written for
  this plugin: it maps Superpowers' dispatch rules onto DeepSeek Harness
  (`delegate_skill` rather than the platform subagent tools).
- Files under `preset/skills/using-superpowers/references/` for other
  platforms (codex, gemini, pi, hermes, muse, claude-code, antigravity) are
  upstream's and are unmodified; they are retained because the skill reads them
  as a cross-platform reference.

Everything else under `preset/skills/` is upstream, unmodified.
