/**
 * 委派服务的载荷契约（与 dsh-acp-agent 的 src/delegation-contract.ts 逐字同形）。
 *
 * 两个插件互不 import：acp-agent 负责通路（把外部 agent 的委派请求送进宿主），
 * superpowers 负责委派实现（按这份形状发布宿主服务）。跨插件只经宿主服务
 * 对接——一个服务名 + 一份载荷形状——所以两边各写一份契约，靠约定与对照
 * 测试钉住形状。改这里必须同步改对面副本；两仓都在场时，acp-agent 仓
 * tests/delegation-contract.spec.ts 的对照用例会抓住漂移。
 *
 * 本文件只有常量、类型（JSDoc）和纯函数，刻意不碰任何对等依赖——
 * 它要在任何环境里裸装载，没有软加载的份。
 */

/** 宿主服务名：superpowers 侧按这个名字发布委派服务，acp-agent 侧按这个名字取。 */
export const DELEGATION_SERVICE = 'superpowers.delegation'

/**
 * 委派请求：父 DSH 会话请宿主替它起一个子代理。
 *
 * @typedef {object} DelegationRequest
 * @property {string} sessionId 父 DSH 会话 id
 * @property {string} [skill] 技能名；缺省 = 走「其他子代理」那一行
 * @property {string} task 短标签
 * @property {string} brief 给孩子的完整任务书（孩子看不到本对话）
 * @property {AbortSignal} [signal] 取消
 */

/**
 * 委派结果：子代理跑完后的最小回报面。
 *
 * @typedef {object} DelegationResult
 * @property {string} output 子代理的最终文本
 * @property {string} model 实际路由；未钉定 = 'inherited'
 * @property {string} childId 子会话 id
 */

/**
 * 收到的值是不是一份 DelegationResult。
 *
 * 载荷跨插件、跨进程边界走，对面来的东西永远是 unknown——判定只认形状
 * （三字段齐全且都是 string），不认识就丢，不在半路抛错把通路弄崩。
 * @param {unknown} value - 任意来路的值
 * @returns {boolean} 是合法 DelegationResult 才返回 true
 */
export function isDelegationResult(value) {
  if (value === null || typeof value !== 'object') return false
  return (
    typeof value.output === 'string'
    && typeof value.model === 'string'
    && typeof value.childId === 'string'
  )
}
