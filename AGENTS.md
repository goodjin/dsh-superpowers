# AGENTS.md

改动这个插件前先读这一页。**上面几节是「怎么干活」，这一节是「这里的实际情况」。**

本文件记的是 DSH 内部接口的现状，不是永久约定。**每条都标了核对时间；
改动相关代码时请顺手复核并更新日期** —— 过期的接口说明比没有更糟，它会把你带向错的方向。

## 这个仓库在机上的三处状态

插件本体在这里，但装到 DSH 上是**散在三个地方**的。改任何一处之前，
先确认另外两处没有跟着指过来：

| 位置 | 是什么 | 改代码时要注意 |
| --- | --- | --- |
| `~/.dsh/.agent-presets/superpowers/` | agent 预设和 15 个技能 | `tool-delegate-skill` 一行用**包引用**（`@goodjin/dsh-superpowers/delegate-skill`）指向 profile 里装好的包。**别改回开发仓库的绝对路径**：开发仓库不装 node_modules，`lib/skill-delegation.js` 顶层 import 的对等依赖解析不到，整棵预设树挂载回滚、web 端无退避反复重试（见下「预设挂载」） |
| `~/.dsh/profiles/web/package.json` | profile 的 bundle 清单 | `dsh.profile.bundles` 里记的是**包名**，要和 `package.json` 的 `name` 完全一致 |
| `~/.dsh/settings.yaml` | `superpowers-delegation` 命名空间 | 存的是路由，格式在 `lib/settings-schema.js` |

**改包名的代价实测过：会直接把 DSH 弄到起不来。** 报错只说「找不到这个 bundle」，
不说是名字对不上，排查起来很费时间。**已经装过的包不要改名。**

改完本仓库记得重新装一次，让 profile 指过来：

```sh
dsh plugin --profile web add goodjin/dsh-superpowers
```

## 改完怎么验

```sh
node scripts/check.mjs <端口> <token>
```

token 在你打开 DSH 的那个地址里，**每次重启都会换**。这个检查是主机侧的；
浏览器侧渲染的东西它看不到，**那部分得请用户看一眼**。

自检里有一条 `delegate.import`：把预设里 `tool-delegate-skill` 那行**按加载器的方式真导入一遍**
（默认查本机正在用的那份预设，第四参数可指定别的副本，比如 `preset/agent.cordis.yml`）。
挂载风暴就是这一行引起的——这条检查不用开 inspector 就能发现。

**改浏览器侧时，先起一个临时端口验，别直接动正在用的那个。**
把 token 抄下来会把它暴露在别处，起新实例反而更安全。

## DSH 接口现状（2026-09 核对）

### 组合与 patch 文件

- `cordis.patch.yml` **必须是一个顶层数组**。
- 数组里一个 `insert:` 元素 = **新增**一组行；一个**裸对象**元素（`id: xxx` / `disabled: true`）=
  **按 id 覆盖**已有行。
- **`remove:` 不是合法写法**，会报 `Cannot read properties of undefined (reading 'startsWith')`。
- 同一个 id 不能既 `insert:` 又重新声明，会报 `duplicate loader entry id`。
- **带命名空间的包名要加引号**（`name: '@goodjin/dsh-superpowers'`）——`@` 在 YAML 开头是保留指示符，
  不加引号直接解析失败，**而且 DSH 会起不来**。
- **一个入口行没有「失败不算数」的开关**。一行里能配的只有 id、name、config、group、disabled、inject。
  所以容错只能写在代码里（`apply` 包 try/catch）。

### 顶部代码 vs 函数内部

**`apply` 里的 try/catch 保护不了模块顶层的代码。** 顶层的错误在进入 `apply` 之前就抛了，
没人能接住，整个服务起不来。校验器之类会随版本失效的构造**必须放在 `apply` 内部**。

（这个坑踩过两次：一次是校验库接口变了，一次是我以为挪进去过其实没挪。）

### 预设挂载（2026-09-29 实测）

- **预设树挂载是整树事务：任何一行导入失败，建到一半的整棵树回滚。** 报错只出现在
  会话创建/恢复的失败信息里，容易被当成偶发。
- **web 客户端对挂载失败没有退避，会按固定频率反复 resume。** 一行坏掉的预设行
  （当时是 `tool-delegate-skill` 指向开发仓库绝对路径、对等依赖解析不到）实测把 CPU
  打到 100%+、每秒约 33 次整树挂载，浏览器端跟着每秒全量重拉接口直到
  `ERR_INSUFFICIENT_RESOURCES`。**预设行写坏的代价是整机卡死，不是单个功能失效。**
- 预设行引用插件自己的模块时，**用包引用（`@goodjin/dsh-superpowers/delegate-skill`，
  `package.json` 的 exports 里有映射），不要用文件绝对路径**——路径指到哪，就按哪里的
  node_modules 解析对等依赖。

### 浏览器侧

- `dsh.client` 行会被扫进 `window.__DSH_BOOT__`，然后从 `/plugins/??<id>/client.js&rev=<rev>` 提供。
  **这个 id 是 loader 行的 `name`，也就是包名**——名册条目的 id 和下发地址用的是同一个值。
  **浏览器模块自己在 `__ModuleLoader__.load({id})` 里写的 id 必须和它一致**（多个 `/client`
  后缀会被剥掉再比），写成别的值浏览器会直接拒绝导入，页面整块报
  `Failed to load plugins ... loaded without registering "<包名>"`，
  而主机侧自检全绿——**这个坑 2026-09-29 踩过：包名改成 @goodjin 带作用域后，
  `lib/client.js` 里的模块 id 忘了跟着改，设置页整个栏目消失。**
  （2026-09-29 复核 dsh-client-modules 源码 + 实机验证。）
- 实际取到的地址里含一个**字面的双问号**：`/plugins/??<id>/client.js&rev=<rev>`。
  按单问号的地址去试一定 404。
- 客户端包是**手写的 CommonJS 工厂**，不用构建：`window.__ModuleLoader__.load({id, factory})`，
  React 走 `require('react')`。
- **用 `React.createElement`，不要用 jsx runtime。** jsxRuntime 在单子节点和零子节点时表现不对。
- 插槽分两种：`kind: "list"`（设置分区、输入框左右、侧栏列表）和 `kind: "single"`（设置项、模型位）。
- **插槽的 `inject` 必须是一个函数**（按上下文算出要传的东西），传数组会静默不工作。
- `conversation.input.left` 是**按空属性渲染**的：拿不到会话 id，得靠插槽自己的 `inject` 传进来。

### 浏览器问主机

- 主机侧用 `ctx.connection.registerFetchRoute(...)` 注册一条**精确路径**的通道
  （**不是** Remote/typert 那套——那套要构建期代码生成，手写包声明不了）。
- 客户端 `ctx.connection.rpc.call(...)` **返回的是外层信封**，成功是 `{ok: true, value}`。
  **直接当数据用会拿到 `undefined`**，而且不报错。

### 会话的模型

- 模型在**每个会话自己的 `modelSelection` 投影**上，从会话历史投影出来的持久值。
  **子代理会话也有**——子会话的输入框没有模型位，就是因为官方那一行对子会话自己不开放，
  不是因为模型没传下来。
- 投影值的形状是 **`{next: {provider, model}}`**，模型在 `next` 里面。
  **读最外层的 `model` 永远是空的。**（这个也踩过。）

### 取模型下拉

- 浏览器列不出 provider（那是进程里的单例，没有客户端投影），**得问主机要**。
- LLM 注册表的服务名有两个可能：`llm` 或 `llmRouter`，**两个都探一下**，别假定一个。

## 这个插件自己的两条约定

1. **官方包都把 DSH 内部包声明成对等依赖，不是普通依赖。** 照做。声明成普通依赖会在用户目录里
   装进第二份框架，两份框架是两套服务登记处，插件会登记到主机看不见的地方——**而且不出错**。
2. **每加一样东西，回头查一遍还在引用旧做法的地方。** 删代码时最容易连带删掉新代码还在用的东西
   （样式块就是这么没的，文档里也留过一句和实际做法相反的话）。
