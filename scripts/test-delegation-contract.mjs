#!/usr/bin/env node
/**
 * 委派服务的载荷契约测试。
 *
 * Why this exists: dsh-acp-agent（通路）与 dsh-superpowers（委派实现）互不
 * import，两边各持一份逐字同形的契约文件，跨插件只经宿主服务对接——一个
 * 服务名 + 一份载荷形状。没有共享模块兜底，形状只能靠测试钉住：一边改了
 * 字段名或判定规则而另一边没跟，桥接要到运行时才会以「形状不认识」炸掉，
 * 那时排查看不出是哪边先漂的。这份测试让漂移在提交前现形。
 *
 * 契约只有常量、类型（JSDoc）和纯函数，不碰任何对等依赖——所以这里
 * 不需要 optional-deps 的软加载，也不分降级/正常两种模式。
 *
 * Exit code 0 when every check passes, 1 otherwise.
 */

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

console.log('\n委派契约测试 — lib/delegation-contract.js\n')

let mod = null

await test('契约文件能装载并导出三样东西', async () => {
  mod = await import(new URL('../lib/delegation-contract.js', import.meta.url).href)
  assert(mod.DELEGATION_SERVICE !== undefined, '应导出 DELEGATION_SERVICE')
  assert(typeof mod.isDelegationResult === 'function', '应导出 isDelegationResult 函数')
})

await test('服务名常量是 superpowers.delegation', () => {
  assert(
    mod.DELEGATION_SERVICE === 'superpowers.delegation',
    `服务名应为 superpowers.delegation，实际 ${mod.DELEGATION_SERVICE}`,
  )
})

await test('isDelegationResult 认得 {output, model, childId} 三字段齐全的对象', () => {
  assert(
    mod.isDelegationResult({ output: '最终文本', model: 'inherited', childId: 'child-1' }) === true,
    '三字段齐全应返回 true',
  )
})

await test('isDelegationResult 拒绝缺字段的对象', () => {
  // 三个必要字段各缺一次：缺哪个都认不出这份结果。
  assert(mod.isDelegationResult({ model: 'inherited', childId: 'child-1' }) === false, '缺 output 应返回 false')
  assert(mod.isDelegationResult({ output: '最终文本', childId: 'child-1' }) === false, '缺 model 应返回 false')
  assert(mod.isDelegationResult({ output: '最终文本', model: 'inherited' }) === false, '缺 childId 应返回 false')
})

await test('isDelegationResult 拒绝非对象与字段类型不对的输入', () => {
  // 载荷跨插件、跨进程边界来，收到什么都得安全地问一句「是不是」。
  assert(mod.isDelegationResult(null) === false, 'null 应返回 false')
  assert(mod.isDelegationResult('最终文本') === false, '字符串应返回 false')
  assert(
    mod.isDelegationResult({ output: 1, model: 'inherited', childId: 'child-1' }) === false,
    '字段类型不对应返回 false',
  )
})

console.log(
  failures.length === 0
    ? `\n全部通过（${passed} 项）。\n`
    : `\n${failures.length} 项不通过：${failures.join('；')}。\n`,
)
process.exit(failures.length === 0 ? 0 : 1)
