#!/usr/bin/env node
/**
 * 委派服务（lib/delegation-service.js）的行为测试。
 *
 * 为什么这份测试只碰假宿主：委派服务把「按钉表定模型、内联技能正文、
 * 起子代理、阻塞等结果」串成一条路，任何一环都不能依赖真模型或真
 * 子代理——测试要能在没有依赖的开发仓库里跑，也要能钉住每一环的
 * 交接形状（钉表 → agentOptions、SKILL.md → 提示、SubagentResult →
 * DelegationResult）。真宿主里的端到端属于装机后的 check，不属于这里。
 *
 * 宿主面的真实形状（对照 @deepseek-ai/dsh-subagent 0.2.1-rc.2/rc.5 核对，
 * 2026-11-05）：
 *
 *   - `ctx.subagents.startActivation(spec)` 是唯一的启动 API。spec =
 *     { provider, label, request: { parent, prompt, agentOptions? }, signal,
 *     delivery: 'parent' | 'caller' }；`delivery: 'caller'` 表示结果只交还
 *     调用方（不经父会话通知），正是阻塞语义。
 *   - 返回 `{ childId, result: Promise<SubagentResult>, dispose }`，其中
 *     SubagentResult = { output: ContentBlock[], structured?, diagnostic?,
 *     stopReason }。
 *
 * 替身按这个形状造：假 startActivation 记下 spec、返回可 resolve 的 run；
 * 假 agents 只认已知的会话 id；假 configEditor 吐出钉表。
 *
 * Exit code 0 when every check passes, 1 otherwise.
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const target = fileURLToPath(new URL('../lib/delegation-service.js', import.meta.url))
const root = join(dirname(target), '..')

const failures = []
let passed = 0

async function test(name, run) {
  try {
    await run()
    passed += 1
    console.log(`  ✓  ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`  ✗  ${name}\n      ${error instanceof Error ? error.message : String(error)}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function rejectsWith(promise, pattern, message) {
  let error = null
  try {
    await promise
  } catch (caught) {
    error = caught
  }
  assert(error !== null, message)
  assert(pattern.test(error.message), `${message} — 实际报错：${error.message}`)
}

// ---------- 宿主替身 ----------

/**
 * 造一个假宿主 ctx 并挂上委派服务。
 *
 * 返回 { ctx, delegate, calls, state }：calls 记下每次 startActivation 收到
 * 的 spec；state 记 dispose 是否被调用、provide 发布到了哪个服务名。
 *
 * @param {object} [overrides]
 * @param {any} [overrides.settings] 钉表（挂在 configEditor 那行上）
 * @param {any} [overrides.startActivation] 替换整个 startActivation（默认吐一个成功 run）
 * @param {any} [overrides.subagents] 替换整个 subagents 服务（缺能力时用）
 * @param {any} [overrides.agentId] agents.get 认得的会话 id
 */
async function makeService(overrides = {}) {
  const { DELEGATION_SERVICE } = await import(
    pathToFileURL(join(root, 'lib', 'delegation-contract.js')).href
  )
  const { NAMESPACE } = await import(
    pathToFileURL(join(root, 'lib', 'settings-schema.js')).href
  )
  const mod = await import(pathToFileURL(target).href)

  const calls = []
  const state = { disposed: false, providedName: null, providedValue: null }
  const agentId = overrides.agentId ?? 'parent-1'
  const parent = { id: agentId }

  const defaultStart = async (spec) => {
    calls.push(spec)
    return {
      childId: 'child-1',
      result: Promise.resolve({
        output: [
          { type: 'text', text: '第一段结论。' },
          { type: 'image', source: { type: 'base64', data: '…' } },
          { type: 'text', text: '第二段结论。' },
        ],
        stopReason: 'completed',
      }),
      dispose: async () => {
        state.disposed = true
      },
    }
  }

  const ctx = {
    provide(name, value) {
      state.providedName = name
      state.providedValue = value
      return () => {}
    },
    get: (service) =>
      service === 'configEditor'
        ? {
          entries: () => [{ options: { id: NAMESPACE }, fiber: { config: overrides.settings ?? {} } }],
        }
        : undefined,
    subagents:
      overrides.subagents ?? { startActivation: overrides.startActivation ?? defaultStart },
    agents: { get: (id) => (id === agentId ? parent : undefined) },
  }

  mod.apply(ctx)
  assert(state.providedName === DELEGATION_SERVICE, `应发布服务 ${DELEGATION_SERVICE}`)
  assert(typeof state.providedValue?.delegate === 'function', '服务上应有 delegate 方法')

  return { ctx, delegate: state.providedValue.delegate, calls, state }
}

/** 基础请求：技能行命中钉表的场景用一个可委派技能。 */
const baseRequest = {
  sessionId: 'parent-1',
  skill: 'test-driven-development',
  task: '标签',
  brief: '完整的任务书内容。',
}

const pinnedSettings = {
  defaultProvider: 'p0',
  defaultModel: 'm0',
  skillModels: {
    'test-driven-development': { provider: 'p1', model: 'm1' },
  },
}

console.log(`\n委派服务测试 — ${target}\n`)

// ---------- 装载与发布 ----------

await test('模块在任何环境下都能装载并导出 name/inject/apply', async () => {
  const mod = await import(pathToFileURL(target).href)
  assert(typeof mod.apply === 'function', '应导出 apply 函数')
  assert(mod.name === 'superpowers-delegation-service', `name 应为 superpowers-delegation-service，实际 ${mod.name}`)
  assert(
    Array.isArray(mod.inject) && ['subagents', 'agents', 'configEditor'].every((s) => mod.inject.includes(s)),
    `inject 应含 subagents/agents/configEditor，实际 ${JSON.stringify(mod.inject)}`,
  )
})

await test('apply 在假宿主上按契约名发布服务（钉住 DELEGATION_SERVICE）', async () => {
  const { DELEGATION_SERVICE } = await import(
    pathToFileURL(join(root, 'lib', 'delegation-contract.js')).href
  )
  const service = await makeService()
  assert(service.state.providedName === DELEGATION_SERVICE, '服务名必须取自契约常量')
})

// ---------- 钉表 → agentOptions ----------

await test('钉表命中技能时，agentOptions 就是钉表那一行（provider/model 原样）', async () => {
  const { delegate, calls } = await makeService({ settings: pinnedSettings })
  await delegate({ ...baseRequest })
  assert(calls.length === 1, `应起一次子代理，实际 ${calls.length}`)
  assert(
    calls[0].request.agentOptions?.provider === 'p1' && calls[0].request.agentOptions?.model === 'm1',
    `agentOptions 应原样为 {provider:'p1',model:'m1'}，实际 ${JSON.stringify(calls[0].request.agentOptions)}`,
  )
})

await test('孩子显式挂带工具的预置（不是继承父会话的预置组合）', async () => {
  const { delegate, calls } = await makeService({ settings: pinnedSettings })
  await delegate({ ...baseRequest })
  assert(calls.length === 1, `应起一次子代理，实际 ${calls.length}`)
  // 父会话若是 ACP 预置，继承来的组合里只有绑定行 → 孩子拿到空工具表。
  // 所以这里必须钉住「孩子自己带预置」，不是「继承」。
  assert(
    calls[0].request.agentPreset === 'standard',
    `孩子应挂 standard 预置，实际 ${JSON.stringify(calls[0].request.agentPreset)}`,
  )
})

await test('宿主不支持独立预置选择时退回继承父会话，且只重试一次', async () => {
  const seen = []
  const { delegate } = await makeService({
    settings: pinnedSettings,
    startActivation: async (spec) => {
      seen.push(spec.request.agentPreset)
      if (spec.request.agentPreset !== undefined) {
        const error = new Error('subagent provider "spawn" does not support independent agent preset selection')
        error.code = 'UNSUPPORTED_CAPABILITY'
        throw error
      }
      return {
        childId: 'child-1',
        result: Promise.resolve({ output: [{ type: 'text', text: '退回继承也跑完了。' }], stopReason: 'completed' }),
        dispose: async () => {},
      }
    },
  })
  const result = await delegate({ ...baseRequest })
  assert(seen.length === 2, `应恰好重试一次，实际调了 ${seen.length} 次：${JSON.stringify(seen)}`)
  assert(seen[0] === 'standard' && seen[1] === undefined, `重试应去掉 agentPreset，实际 ${JSON.stringify(seen)}`)
  assert(result.output.includes('退回继承也跑完了。'), `结果应来自重试那次，实际 ${JSON.stringify(result.output)}`)
})

await test('别的启动失败不重试（可能已经建了半个孩子）', async () => {
  let attempts = 0
  const { delegate } = await makeService({
    settings: pinnedSettings,
    startActivation: async () => {
      attempts += 1
      throw new Error('宿主内部故障：子代理服务未就绪')
    },
  })
  let message = ''
  try {
    await delegate({ ...baseRequest })
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  assert(attempts === 1, `非「不支持预置」的失败不该重试，实际尝试 ${attempts} 次`)
  assert(message.includes('子代理服务未就绪'), `错误应原样冒泡，实际 ${message}`)
})

await test('钉表未命中该技能、但有默认行时，用默认行', async () => {
  const { delegate, calls } = await makeService({ settings: pinnedSettings })
  await delegate({ ...baseRequest, skill: 'writing-skills' })
  assert(
    calls[0].request.agentOptions?.provider === 'p0' && calls[0].request.agentOptions?.model === 'm0',
    `未钉技能应走默认行 {provider:'p0',model:'m0'}，实际 ${JSON.stringify(calls[0].request.agentOptions)}`,
  )
})

await test('钉表解析为 null（哨兵/未配置）时不传 agentOptions，model 报 inherited', async () => {
  const { delegate, calls } = await makeService({
    settings: {
      defaultProvider: 'p0',
      defaultModel: 'm0',
      skillModels: { 'test-driven-development': { provider: '__sp_use_parent_session__', model: '__sp_use_parent_session__' } },
    },
  })
  const result = await delegate({ ...baseRequest })
  assert(calls[0].request.agentOptions === undefined, 'route 为 null 时不应写入 agentOptions')
  assert(result.model === 'inherited', `model 应为 inherited，实际 ${result.model}`)
})

// ---------- 校验 ----------

await test('技能名不在 DELEGABLE_SKILLS 里 → 委派失败，错误文本含该技能名', async () => {
  const { delegate, calls } = await makeService({ settings: pinnedSettings })
  await rejectsWith(
    delegate({ ...baseRequest, skill: 'no-such-skill' }),
    /no-such-skill/,
    '未知技能应点名报错',
  )
  assert(calls.length === 0, '校验失败时不应起子代理')
})

await test('缺 sessionId / task / brief 时点名报字段名', async () => {
  const { delegate } = await makeService({ settings: pinnedSettings })
  await rejectsWith(delegate({ ...baseRequest, sessionId: '' }), /sessionId/, '缺 sessionId 应报字段名')
  await rejectsWith(delegate({ ...baseRequest, task: '' }), /task/, '缺 task 应报字段名')
  await rejectsWith(delegate({ ...baseRequest, brief: '' }), /brief/, '缺 brief 应报字段名')
})

await test('空白技能名视为未指定（null），走默认行', async () => {
  const { delegate, calls } = await makeService({ settings: pinnedSettings })
  await delegate({ ...baseRequest, skill: '   ' })
  assert(calls.length === 1, '空白技能名是合法调用（通用行），应正常起子代理')
  assert(calls[0].request.agentOptions?.provider === 'p0', '通用行走默认行')
  assert(calls[0].label === '[通用] 标签', `无技能时 label 应为 [通用] 前缀，实际 ${calls[0].label}`)
})

await test('父会话不活着时点名报 sessionId，不起子代理', async () => {
  const { delegate, calls } = await makeService({ settings: pinnedSettings })
  await rejectsWith(
    delegate({ ...baseRequest, sessionId: 'gone-session' }),
    /gone-session/,
    '找不到父会话应报出 sessionId',
  )
  assert(calls.length === 0, '拿不到父 Agent 时不应起子代理')
})

await test('宿主缺阻塞启动能力时报明确错误，不静默退化', async () => {
  const { delegate } = await makeService({
    settings: pinnedSettings,
    subagents: { startContinuable: async () => ({ childId: 'x' }) },
  })
  await rejectsWith(
    delegate(baseRequest),
    /宿主只提供可续聊子代理，无法阻塞等结果/,
    '缺 startActivation 应报出这句明确错误',
  )
})

// ---------- 技能正文内联 ----------

await test('技能正文整篇内联进初始提示，且含技能目录绝对路径与 brief', async () => {
  const { delegate, calls } = await makeService({ settings: pinnedSettings })
  await delegate({ ...baseRequest })
  const prompt = calls[0].request.prompt
  assert(Array.isArray(prompt) && prompt.length === 1 && prompt[0].type === 'text', '提示应为单个 text 块')
  const text = prompt[0].text

  const skillBody = await readFile(
    join(root, 'preset', 'skills', 'test-driven-development', 'SKILL.md'),
    'utf8',
  )
  assert(text.includes(skillBody), 'SKILL.md 全文应内联进提示')
  const expectedDir = join(root, 'preset', 'skills', 'test-driven-development')
  assert(text.includes(expectedDir), `提示应含技能目录绝对路径 ${expectedDir}`)
  assert(text.includes(baseRequest.brief), '提示应含完整 brief')
})

// ---------- 返回值形状与资源释放 ----------

await test('返回 {output, model, childId}：output 拼接文本块，model 是路由串，childId 来自 run', async () => {
  const { delegate } = await makeService({ settings: pinnedSettings })
  const result = await delegate({ ...baseRequest })
  assert(result.output === '第一段结论。\n第二段结论。', `output 应拼接 text 块（\\n 分隔），实际 ${JSON.stringify(result.output)}`)
  assert(result.model === 'p1/m1', `model 应为 p1/m1，实际 ${result.model}`)
  assert(result.childId === 'child-1', `childId 应取自子代理返回，实际 ${result.childId}`)
})

await test('成功路径也调用 dispose，且透传调用方的取消 signal', async () => {
  const controller = new AbortController()
  const { delegate, calls, state } = await makeService({ settings: pinnedSettings })
  await delegate({ ...baseRequest, signal: controller.signal })
  assert(state.disposed, '拿到结果后必须 dispose，否则子代理资源不释放')
  assert(calls[0].signal === controller.signal, 'request.signal 应原样透传给子代理启动')
})

await test('未传 signal 时自己造一个取消通道（宿主的 signal 是必填）', async () => {
  const { delegate, calls } = await makeService({ settings: pinnedSettings })
  await delegate({ ...baseRequest })
  assert(calls[0].signal instanceof AbortSignal, '宿主 spec 必须带上一个 AbortSignal')
})

await test('stopReason 非 completed 时报错并带上原因，dispose 仍被调用', async () => {
  const { delegate, state } = await makeService({
    settings: pinnedSettings,
    startActivation: async () => ({
      childId: 'child-err',
      result: Promise.resolve({ output: [], diagnostic: '上游模型 500', stopReason: 'error' }),
      dispose: async () => {
        state.disposed = true
      },
    }),
  })
  await rejectsWith(
    delegate(baseRequest),
    /error.*上游模型 500|上游模型 500.*error/s,
    '非 completed 应报出 stopReason 与诊断',
  )
  assert(state.disposed, '失败路径同样要释放子代理资源')
})

await test('result 整体 reject（基础设施故障）时错误冒泡，dispose 仍被调用', async () => {
  const { delegate, state } = await makeService({
    settings: pinnedSettings,
    startActivation: async () => ({
      childId: 'child-infra',
      result: Promise.reject(new Error('activation 通道断了')),
      dispose: async () => {
        state.disposed = true
      },
    }),
  })
  await rejectsWith(delegate(baseRequest), /activation 通道断了/, '基础设施故障应原样冒泡')
  assert(state.disposed, 'reject 路径同样要释放子代理资源')
})

await test('路由记进台账，浏览器侧才看得到这个孩子的模型', async () => {
  const { allRoutes } = await import(pathToFileURL(join(root, 'lib', 'records.js')).href)
  const { delegate } = await makeService({
    settings: pinnedSettings,
    startActivation: async () => ({
      childId: 'child-ledger',
      result: Promise.resolve({ output: [{ type: 'text', text: '完成' }], stopReason: 'completed' }),
      dispose: async () => {},
    }),
  })
  await delegate(baseRequest)
  assert(
    allRoutes()['child-ledger']?.provider === 'p1' && allRoutes()['child-ledger']?.model === 'm1',
    '台账应记下子代理的实际路由',
  )
})

// ---------- summary ----------

console.log(
  failures.length === 0
    ? `\n全部通过（${passed} 项）。\n`
    : `\n${failures.length} 项不通过：${failures.join('；')}。\n`,
)
process.exit(failures.length === 0 ? 0 : 1)
