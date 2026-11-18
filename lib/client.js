window.__ModuleLoader__.load({
  id: '@goodjin2/dsh-superpowers',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const jsxRuntime = require('react/jsx-runtime')
    const React = require('react')

    // Mirror lib/delegable-skills.js — the browser bundle cannot import that module.
    const SKILLS = [
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

    const INHERIT = '__sp_follow_default__'
    const REUSE_PARENT = '__sp_use_parent_session__'

    /**
     * One read/write round trip to the Host over the /api/superpowers route.
     *
     * `rpc.call` resolves with the RPC RESULT ENVELOPE, not with the handler's
     * return value: on success that envelope is `{ok: true, value: <return>}`,
     * on failure `{ok: false, error: {...}}`. An earlier revision handed the
     * envelope straight back to its callers, so `settings.skillModels` was
     * always undefined and the option list was an object where an array was
     * expected. The section rendered blank with no error, which is what that
     * looked like from the outside.
     */
    async function call(ctx, endpoint, value) {
      const result = await ctx.connection.rpc.call(
        '/api',
        'superpowers',
        value === undefined ? { endpoint } : { endpoint, value },
      )
      if (result === null || typeof result !== 'object') {
        throw new Error(`superpowers: ${endpoint} returned ${String(result)}, not an RPC result`)
      }
      if (result.ok !== true) {
        throw new Error(`superpowers: ${endpoint} failed: ${result.error?.message ?? JSON.stringify(result.error)}`)
      }
      return result.value
    }

    const h = React.createElement

    /**
     * A scoped stylesheet, because this section's elements carry their own class
     * names and no shipped stylesheet defines them. Every rule is nested under
     * `.spx` so nothing here can reach the rest of the settings panel.
     *
     * The layout is a two-column grid rather than flexbox: a grid column cannot
     * be collapsed by a long label, so the control keeps a fixed width and every
     * row lines up the same way.
     */
    const STYLE = `
      .spx { display: flex; flex-direction: column; gap: 14px; width: 100%; padding: 6px 0 10px; }
      .spx-row { display: grid; grid-template-columns: minmax(0, 1fr) 280px; align-items: center; gap: 24px; padding: 5px 0; }
      .spx-row > label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.5; }
      .spx-row > select { width: 100%; min-width: 0; height: 32px; padding: 0 10px; border-radius: 6px; }
      .spx-rule { width: 100%; margin: 12px 0; opacity: .2; }
      .spx-hint { margin: 0 0 2px; opacity: .7; line-height: 1.5; }
      .spx-error { margin: 0; color: #e5534b; white-space: pre-wrap; font-size: 12px; line-height: 1.5; }
      .spx-model { opacity: .8; font-size: 12px; }
      .spx-health { display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border-radius: 8px; font-size: 12px; line-height: 1.6; }
      .spx-health-dot { flex: 0 0 auto; font-weight: 700; }
      .spx-health-ok { background: rgba(46, 160, 67, .12); }
      .spx-health-bad { background: rgba(229, 83, 75, .14); }
      .spx-health-unknown { background: rgba(127, 127, 127, .16); }
      .spx-health-item { margin-left: 6px; opacity: .9; }
      @media (max-width: 640px) { .spx-row { grid-template-columns: 1fr; gap: 8px; } }
    `

    /**
     * Insert the stylesheet once, on the document, if it is not already there.
     * A missing `document` is a non-event: the browser half only ever runs in
     * one, and a missing head means nothing useful is on screen anyway.
     */
    function ensureStyles() {
      if (typeof document === 'undefined' || document.head === null) return
      if (document.getElementById('dsh-superpowers-style') !== null) return
      const tag = document.createElement('style')
      tag.id = 'dsh-superpowers-style'
      tag.textContent = STYLE
      document.head.appendChild(tag)
    }

    /**
     * A labelled dropdown over `options`, plus the inherit option.
     *
     * The prop is `onPick`, NOT `onChange`, and the handler is wired as
     * `onChange: onSelect` on the <select>. An earlier revision destructured a
     * prop literally called `onChange` and then passed that same name to the
     * <select>, so React handed the parent's callback the raw change EVENT
     * instead of a route. The event went into the settings payload, and
     * serialising it for the Host walked into the <option> DOM node and its
     * React internals: "Converting circular structure to JSON".
     */
    function isReuseParent(route) {
      return route !== null
        && typeof route === 'object'
        && route.provider === REUSE_PARENT
        && route.model === REUSE_PARENT
    }

    function routeSelectValue(route, showFollowDefault) {
      if (showFollowDefault) {
        if (route === null) return INHERIT
        if (isReuseParent(route)) return REUSE_PARENT
        return `${route.provider}/${route.model}`
      }
      if (route === null || isReuseParent(route)) return REUSE_PARENT
      return `${route.provider}/${route.model}`
    }

    /**
     * @param {{label: string, value: {provider: string, model: string} | null, options: any[], onPick: (route: any) => void, showFollowDefault?: boolean}} props
     */
    function RouteSelect(props) {
      const { label, value, options, onPick, showFollowDefault = true } = props
      const items = [{ provider: '', model: '' }, ...options]
      const current = routeSelectValue(value, showFollowDefault)
      const onSelect = (event) => {
        const picked = event.target.value
        if (picked === INHERIT) {
          onPick(null)
          return
        }
        if (picked === REUSE_PARENT) {
          onPick({ provider: REUSE_PARENT, model: REUSE_PARENT })
          return
        }
        const found = items.find((option) => `${option.provider}/${option.model}` === picked)
        onPick(found === undefined ? null : { provider: found.provider, model: found.model })
      }
      return h(
        'div',
        { className: 'spx-row' },
        h('label', { className: 'spx-label', title: label }, label),
        h(
          'select',
          { className: 'spx-select', value: current, onChange: onSelect },
          ...(showFollowDefault ? [h('option', { value: INHERIT }, '跟随默认')] : []),
          h('option', { value: REUSE_PARENT }, '复用主会话模型'),
          ...items
            .filter((option) => option.provider !== '')
            .map((option) => h(
              'option',
              { key: `${option.provider}/${option.model}`, value: `${option.provider}/${option.model}` },
              // Display names, falling back to the wire ids the stored route keeps.
              // The VALUE stays the wire pair: settings persist provider/model ids,
              // and delegation spawns by them — only the label is human wording.
              `${option.providerName ?? option.provider} · ${option.name ?? option.model}`,
            )),
        ),
      )
    }

    function Section(props) {
      const { ctx } = props
      const [state, setState] = React.useState({ loaded: false, value: null, options: [], diag: null, error: null })
      const [saving, setSaving] = React.useState(false)

      React.useEffect(() => {
        let live = true
        Promise.all([call(ctx, 'delegation.read'), call(ctx, 'modelOptions'), call(ctx, 'diagnostics')]).then(
          ([value, options, diag]) => {
            if (live) setState({ loaded: true, value, options, diag, error: null })
          },
          (error) => {
            if (live) setState({ loaded: false, value: null, options: [], diag: null, error: String(error) })
          },
        )
        return () => {
          live = false
        }
      }, [ctx])

      if (state.error !== null) {
        return h('div', { className: 'spx' }, h('p', { className: 'spx-error' }, `无法读取 superpowers 分档设置：${state.error}`))
      }
      if (!state.loaded) return h('div', { className: 'spx' }, h('p', { className: 'spx-hint' }, '正在加载…'))

      // Both are Host-supplied, so both are checked rather than assumed: a
      // malformed reply must render an empty section, never a blank one.
      const value = state.value !== null && typeof state.value === 'object' ? state.value : {}
      const skillModels = value.skillModels !== null && typeof value.skillModels === 'object' ? value.skillModels : {}
      const optionList = Array.isArray(state.options) ? state.options : []

      const apply = async (next) => {
        setSaving(true)
        try {
          const saved = await call(ctx, 'delegation.write', next)
          setState((prior) => ({ ...prior, value: saved, error: null }))
        } catch (error) {
          setState((prior) => ({ ...prior, error: String(error) }))
        } finally {
          setSaving(false)
        }
      }

      const setSkill = (skill, route) => {
        const next = { ...skillModels }
        if (route === null) delete next[skill]
        else next[skill] = route
        return apply({ skillModels: next })
      }

      const otherRowValue = (() => {
        if (typeof value.defaultProvider !== 'string' || typeof value.defaultModel !== 'string') return null
        return { provider: value.defaultProvider, model: value.defaultModel }
      })()

      return h(
        'div',
        {},
        h(HealthLine, { diag: state.diag }),
        h('p', { className: 'spx-hint' }, saving ? '保存中…' : '每个技能可以单独指定子代理使用的模型。'),
        ...SKILLS.map((skill) => h(RouteSelect, {
          key: skill,
          label: skill,
          value: skillModels[skill] ?? null,
          options: optionList,
          onPick: (route) => void setSkill(skill, route),
        })),
        h('hr', { className: 'spx-rule' }),
        h(RouteSelect, {
          label: '其他子代理使用的模型',
          value: otherRowValue,
          options: optionList,
          showFollowDefault: false,
          onPick: (route) => void apply(route === null
            ? { defaultProvider: undefined, defaultModel: undefined }
            : { defaultProvider: route.provider, defaultModel: route.model }),
        }),
      )
    }

    /**
     * Pull the `{provider, model}` wire route out of a `modelSelection`
     * projection value.
     *
     * The projection carries `{next: <selection>}` — a pending next-request
     * selection — where the selection itself is `{provider, model}`. Reading
     * `.model` off the top level returns undefined forever, which is how an
     * earlier revision of this label managed to render nothing on every
     * subagent while looking perfectly correct. Both shapes are accepted so a
     * future flattening of the projection degrades into "still shows" rather
     * than "silently blank".
     */
    function readProjectedRoute(value) {
      if (value === null || typeof value !== 'object') return null
      const selection = value.next !== null && typeof value.next === 'object' ? value.next : value
      if (typeof selection.provider === 'string' && selection.provider !== ''
        && typeof selection.model === 'string' && selection.model !== '') {
        return { provider: selection.provider, model: selection.model }
      }
      return null
    }

    /**
     * Wire route → display name, resolved from the Host's model catalog — the
     * same source the shipped model picker labels its options from.
     *
     * Returns `null` (not a throw) whenever the catalog is unavailable: an
     * older DSH without the remote face, a failed load, a malformed reply.
     * A null map makes every caller fall back to the wire id, which is the
     * pre-catalog behaviour — a degraded label, never a missing or broken one.
     *
     * Everything is reached through optional chaining inside an async body, so
     * even a hostile injected face (every method throws, as the activation
     * precheck's degraded renderer does) becomes a rejection this callers
     * swallow, not a crash of the seat.
     */
    async function loadModelNames(ctx) {
      if (typeof ctx.remote?.session?.modelCatalog !== 'function') return null
      const response = await ctx.remote.session.modelCatalog()
      if (response === null || typeof response !== 'object' || response.ok !== true) return null
      const groups = response.value?.groups
      if (!Array.isArray(groups)) return null
      const names = new Map()
      for (const group of groups) {
        if (group === null || typeof group !== 'object' || !Array.isArray(group.models)) continue
        if (typeof group.id !== 'string') continue
        for (const model of group.models) {
          if (model === null || typeof model !== 'object') continue
          if (typeof model.id === 'string' && typeof model.name === 'string' && model.name !== '') {
            names.set(`${group.id}/${model.id}`, {
              providerName: typeof group.name === 'string' && group.name !== '' ? group.name : group.id,
              modelName: model.name,
            })
          }
        }
      }
      return names
    }

    /**
     * The read-only model label shown inside a subagent's composer, in the
     * model's DISPLAY name.
     *
     * The wire route comes straight from the session's own `modelSelection`
     * projection — the durable selection projected from that session's history.
     * The shipped composer model seat reads the same face, and because the
     * projection is written into history it is present for EVERY session,
     * subagent children included. Nothing here is specific to how a child was
     * dispatched: a child started by any tool reports its real model.
     *
     * An earlier revision kept a Host-side ledger keyed by child id and asked
     * the Host over RPC, which only ever knew about children this preset
     * dispatched itself. Every other child rendered nothing — silently, and
     * indistinguishable from a session with no model.
     *
     * The display name is resolved through `loadModelNames` above; until (or
     * unless) it lands, the label shows the wire id — what it showed before.
     */
    function SubagentModel(props) {
      const { ctx, sessionId } = props
      const [route, setRoute] = React.useState(null)
      const [names, setNames] = React.useState(null)

      // The catalog is account-level, not session-level: one load serves every
      // subagent label on the page. Its failure mode is silence by design —
      // the label keeps showing the wire id it showed before this existed.
      React.useEffect(() => {
        let live = true
        loadModelNames(ctx).then(
          (map) => { if (live) setNames(map) },
          () => { if (live) setNames(null) },
        )
        return () => { live = false }
      }, [ctx])

      React.useEffect(() => {
        const binding = ctx.sessions.binding(sessionId)
        const face = binding?.session?.projections?.faceOf?.('modelSelection')
        if (face === undefined) return undefined
        // A projection face always exists once asked for; absence of a VALUE is
        // undefined, and a child whose model was never projected simply has none.
        const read = () => {
          setRoute(readProjectedRoute(face.getSnapshot()))
        }
        read()
        return face.subscribe(read)
      }, [ctx, sessionId])

      if (route === null) return null
      const found = names?.get(`${route.provider}/${route.model}`)
      // 带上提供方前缀，与 dsh-acp-agent 的模型标签同一套规范：一律加、不去重
      // ——模型名里碰巧含提供方名不是「已带前缀」的信号，去重会让规则跟着命名漂。
      // 目录拿不到时回退整段线路 id（provider/model），照样看得出是哪家。
      const label = found === undefined
        ? `${route.provider}/${route.model}`
        : `${found.providerName} · ${found.modelName}`
      return h(
        'span',
        {
          className: 'spx-model',
          title: `显示名称；实际模型路由 ${route.provider}/${route.model}（子代理的模型在派出时设定，这里只读）`,
        },
        label,
      )
    }

/**
     * The health line at the top of the settings section.
     *
     * This plugin's characteristic failure mode is silent: when a DSH upgrade
     * moves an internal API, nothing throws, the server still boots, and the
     * feature simply stops existing. A user cannot tell "the model I set is
     * being ignored" from "the model I set was never read". So the host's
     * diagnostics are shown here, in the one place the user already opens
     * after an upgrade, instead of in a log nobody reads.
     *
     * A missing or malformed report renders as unknown rather than as success —
     * "cannot tell" must never look like "working".
     */
    function HealthLine(props) {
      const { diag } = props
      if (diag === null || typeof diag !== 'object' || !Array.isArray(diag.checks)) {
        return h(
          'div',
          { className: 'spx-health spx-health-unknown' },
          h('span', { className: 'spx-health-dot' }, '?'),
          h('span', null, '自检没跑起来：插件和主机的通信可能已经断了，下面这些设置未必生效。'),
        )
      }
      const failed = diag.checks.filter((check) => check?.ok !== true)
      if (failed.length === 0) {
        return h(
          'div',
          { className: 'spx-health spx-health-ok' },
          h('span', { className: 'spx-health-dot' }, '✓'),
          h('span', null, `自检通过（${diag.checks.length} 项），下面的配置已生效。`),
        )
      }
      return h(
        'div',
        { className: 'spx-health spx-health-bad' },
        h('span', { className: 'spx-health-dot' }, '!'),
        h(
          'div',
          null,
          h('div', null, `自检发现 ${failed.length} 项异常，DSH 升级可能改了内部接口：`),
          ...failed.map((check) =>
            h('div', { key: check.name, className: 'spx-health-item' }, `· ${check.detail}`),
          ),
        ),
      )
    }

    /**
     * Decides whether this composer belongs to a subagent, and shows the model
     * only then.
     *
     * The session id arrives as an owner prop. It is read defensively because a
     * missing id must mean "render nothing", never a throw: this seat is
     * additive, and a seat that breaks the composer would be far worse than a
     * label that does not appear.
     */
    function SubagentModelHost(props) {
      const { ctx, sessionId } = props
      if (typeof sessionId !== 'string') return null
      // Only subagent sessions get the label; a main session keeps the shipped
      // picker in its own place and needs nothing added.
      if (typeof ctx.sessions?.subagentAddress !== 'function') return null
      if (ctx.sessions.subagentAddress(sessionId) === undefined) return null
      return h(SubagentModel, { ctx, sessionId })
    }

    // `remote` (and its session face) feed `loadModelNames`: the Host's model
    // catalog is the display-name source for the subagent label. Declared
    // alongside the rest so the injection resolves in one pass — a nested
    // inject on a derived context never fires.
    const inject = ['slots', 'connection', 'sessions', 'remote', 'remote.session']

    /**
     * One slot registration, guarded on its own.
     *
     * The activation precheck runs apply() against a fully degraded renderer
     * where every declared service's method call throws — and `slots.inject`
     * is exactly such a method call. Without a guard the throw pierces apply,
     * the whole row fails to activate, and BOTH pieces vanish. Guarded per
     * slot instead: a broken slot host degrades to that one piece missing
     * (settings section, or the subagent label) while the other still mounts.
     *
     * Diagnostics go through console.error on purpose: the renderer sandbox has
     * no `process.stderr`, and console.* always exists.
     */
    function guardedSlotInject(ctx, slotName, register) {
      try {
        ctx.slots.inject(slotName, register)
      } catch (error) {
        console.error(`[superpowers] 插槽 ${slotName} 未注册（插槽服务不可用，只影响这一块）：`
          + (error instanceof Error ? error.message : String(error)))
      }
    }

    function apply(ctx) {
      ensureStyles()
      guardedSlotInject(ctx, 'settings.section', () => {
        return ctx.slots.register({
          name: 'settings.section',
          id: 'superpowers',
          order: 30,
          label: () => 'Superpowers',
          // No `inject` here on purpose. The shipped occupants pass a FUNCTION
          // that builds the injected face; an earlier revision of this row passed
          // an array, and a slot whose inject it cannot resolve leaves its body
          // unmounted — the nav entry still appears, the panel renders empty.
          // This component already closes over `ctx`, so it needs nothing from the
          // slot's owner props and nothing from an inject face.
        }, () => h(Section, { ctx }))
      })

      // `conversation.input.left` is an additive LIST seat, so registering here
      // cannot displace the shipped model picker. That picker is a separate
      // SINGLE slot this plugin deliberately does NOT claim: the only way to
      // take it is to disable the row that also provides `modelDirectories`,
      // and a plain replacement would cost every main session its two-level
      // picker. The trade-off is placement — the label sits beside the model
      // seat rather than in it.
      guardedSlotInject(ctx, 'conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'subagent-model',
        order: 20,
        // The composer renders this slot with NO props (`renderSlot(
        // 'conversation.input.left', {})`), so the session id is not in the
        // owner props and never will be. It arrives through the slot's inject,
        // which is a FUNCTION of the session id — the same shape the shipped
        // model seat uses. Without this the seat silently renders nothing,
        // because it has no way to tell which session it is inside.
        inject: (sessionId) => ({ sessionId }),
      }, (slotProps) => h(SubagentModelHost, { ...slotProps, ctx })))
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = 'superpowers-client'
    return module.exports
  },
})
