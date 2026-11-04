import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { DELEGATION_SERVICE } from './delegation-contract.js'
import { DELEGABLE_SKILLS } from './delegable-skills.js'
import { NAMESPACE, resolveRoute, unvolatile } from './settings-schema.js'
import { recordRoute } from './records.js'

/**
 * 委派服务：把「外部 agent 请宿主替它干活」落到 DSH 侧（Task 4）。
 *
 * 通路在对面：dsh-acp-agent 的桥接进程按 `DELEGATION_SERVICE` 这个名字取
 * 本服务，把外部 agent 的调用转过来。两仓互不 import，只经宿主服务对接，
 * 载荷形状由 lib/delegation-contract.js 的契约钉住。
 *
 * 这是主机侧行（挂在 cordis.patch.yml 顶层数组里，不进预设清单）：
 * 消费者是主机侧的桥接行，服务必须不依赖任何预设挂载就存在——和
 * superpowers-delegation-settings 同理。预设内的服务行必须裹 isolate
 * realm，而 realm 里的提供对主机侧消费方不可见；这一行发布进 ROOT realm
 * 才是它的本意（预设行发布进 ROOT 反而是泄漏审计要拦的事，见任务书）。
 *
 * 阻塞语义是本服务的本质：`delegate(request)` 返回时必须带着子代理的
 * 最终文本。所以启动走 `ctx.subagents.startActivation` + `delivery:
 * 'caller'`——结果只交还调用方，不经父会话通知；`await run.result` 就是
 * 「跑完了」的那个信号。宿主没有「只返回 childId、结果异步到达」的
 * continuable 入口可供等待，静默退化成后台委派等于把调用方丢在原地。
 */

export const name = 'superpowers-delegation-service'

export const inject = ['subagents', 'agents', 'configEditor']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {any} [config]
 */
export function apply(ctx, config = {}) {
  // 主机侧行在进程启动的组合里运行：这里抛出去不是「一个插件失败」，
  // 是整个组合起不来，殃及所有预设和会话。DSH 对装载行没有「失败不算
  // 数」的开关，容错只能写在代码里。发布失败时大声记日志并放弃——
  // 委派功能缺失是可见、可修的降级，不是连坐整树的故障。
  try {
    ctx.provide(DELEGATION_SERVICE, { delegate: (request) => delegate(ctx, request) })
  } catch (error) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
    console.error(
      `[superpowers-delegation] 委派服务 "${DELEGATION_SERVICE}" 未发布；DSH 照常启动，`
        + '外部 agent 的委派调用会失败。\n'
        + `Repair the plugin, or drop "@goodjin2/dsh-superpowers/delegation-service" from the profile to silence this.\n${detail}`,
    )
  }
}

/**
 * 执行一次委派：校验 → 定路由 → 组提示 → 起子代理 → 阻塞等结果。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {any} request - DelegationRequest（见 lib/delegation-contract.js）
 * @returns {Promise<import('./delegation-contract.js').DelegationResult>}
 */
async function delegate(ctx, request) {
  // 1. 载荷来自跨插件（乃至跨进程）边界，按「缺就点名」校验，不猜。
  if (request === null || typeof request !== 'object') {
    throw new Error('委派请求不是对象')
  }
  for (const field of ['sessionId', 'task', 'brief']) {
    if (typeof request[field] !== 'string' || request[field] === '') {
      throw new Error(`委派请求缺字段：${field}`)
    }
  }

  // 2. 技能名：缺省或空白视为 null（「其他子代理」行），有就要在清单内。
  const skill = typeof request.skill === 'string' && request.skill.trim() !== ''
    ? request.skill.trim()
    : null
  if (skill !== null && !DELEGABLE_SKILLS.includes(skill)) {
    throw new Error(`技能 ${skill} 不在可委派清单里（可用：${DELEGABLE_SKILLS.join('、')}）`)
  }

  // 3. 钉表 → 路由。null 表示不覆盖（哨兵「跟随主会话」或什么都没配），
  //    此时省略 agentOptions，孩子继承父会话的模型。
  const route = resolveRoute(hostDelegationConfig(ctx), skill)

  // 4. 父会话：宿主要求 request.parent 是「当前活着的那个 Agent 对象」，
  //    所以必须从 agents 服务现取，不能由调用方递一个 id 进来就信。
  const parent = ctx.agents?.get(request.sessionId)
  if (parent === undefined) {
    throw new Error(`找不到会话 ${request.sessionId} 对应的活 Agent：委派需要一个活着的父 DSH 会话`)
  }

  // 5. 能力探测探「函数在不在」，不探「服务在不在」：注入满足了
  //    'subagents' 只说明有这个服务，不保证它有阻塞启动的入口（本仓
  //    2026-10-16 的教训——装了但版本不对的依赖照样 truthy，只是没有
  //    你要的那个函数）。缺了就报明确错误，绝不静默退化成后台委派。
  if (typeof ctx.subagents?.startActivation !== 'function') {
    throw new Error('宿主只提供可续聊子代理，无法阻塞等结果（ctx.subagents.startActivation 不可用）')
  }

  // 6. 技能正文 + 目录绝对路径。路径从本包自身解析（import.meta.url），
  //    不依赖 cwd——调用方进程的 cwd 和本包的安装位置毫无关系。
  let text
  if (skill === null) {
    text = request.brief
  } else {
    const bodyPath = fileURLToPath(new URL(`../preset/skills/${skill}/SKILL.md`, import.meta.url))
    const skillDir = fileURLToPath(new URL(`../preset/skills/${skill}`, import.meta.url))
    let body
    try {
      body = await readFile(bodyPath, 'utf8')
    } catch (error) {
      throw new Error(`读取技能 ${skill} 的正文失败：${error instanceof Error ? error.message : String(error)}`)
    }
    text = [
      body,
      '',
      `技能目录（技能正文里的相对路径以此为基准）：${skillDir}`,
      '',
      request.brief,
    ].join('\n')
  }

  // 7. 起子代理。signal 是宿主 spec 的必填取消通道：调用方给了就透传，
  //    没给就自己造一个——「不可取消」不是合法状态。
  const activation = await ctx.subagents.startActivation({
    provider: 'spawn',
    label: skill === null ? `[通用] ${request.task}` : `[${skill}] ${request.task}`,
    request: {
      parent,
      prompt: [{ type: 'text', text }],
      ...(route === null ? {} : { agentOptions: route }),
    },
    signal: request.signal ?? new AbortController().signal,
    delivery: 'caller',
  })

  // 8. 阻塞等结果；无论成败都 dispose，否则子代理资源不释放。dispose 的
  //    失败不吞掉结果：资源回收的故障宿主自己会报，调用方要的是子代理
  //    跑出来的东西（或它的失败原因）。
  let result
  try {
    result = await activation.result
  } finally {
    await activation.dispose().catch(() => undefined)
  }

  // 9. 非 completed 的结果不可当成功交差：output 可能是空的或截断的，
  //    原样返回会让调用方把失败当报告收下。报出 stopReason 与诊断。
  if (result.stopReason !== 'completed') {
    throw new Error(
      `子代理未正常结束（stopReason: ${result.stopReason}）：`
      + (typeof result.diagnostic === 'string' && result.diagnostic !== '' ? result.diagnostic : '子代理未给出诊断信息'),
    )
  }

  // 10. 路由记进台账：这是浏览器侧唯一能看到「这个孩子用的哪个模型」的
  //     地方，和 delegate_skill 工具那条路保持同一本账。
  recordRoute(activation.childId, route)

  return {
    output: (result.output ?? [])
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n'),
    model: route === null ? 'inherited' : `${route.provider}/${route.model}`,
    childId: activation.childId,
  }
}

/**
 * 读钉表：与 lib/skill-delegation.js 的 hostDelegationConfig 逐字同款
 * （任务书要求照抄，两处刻意不抽公共函数——那条路属于预设行，这条路
 * 属于主机行，生命周期不同，各自带着走）。
 *
 * @param {any} ctx - a context carrying `configEditor`
 * @returns {any} the row's config, or undefined
 */
function hostDelegationConfig(ctx) {
  const editor = ctx.get('configEditor')
  if (editor === undefined || typeof editor.entries !== 'function') return undefined
  const entry = editor.entries().find((row) => row.options?.id === NAMESPACE)
  return entry === undefined ? undefined : unvolatile(entry.fiber?.config)
}
