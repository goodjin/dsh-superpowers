# 改造方案：适配 DSH 0.2.x 的插件机制

> 目标版本：DSH 0.2.0-rc.2（cordis 4.0.4）
> 现状：主机侧在新版下**两处静默失效**，设置页完全不可用
> 原则：先查清规则再动手，方案确认后再改代码

---

## 一、问题清单（已实测确认）

| # | 问题 | 根因 | 影响 |
|---|---|---|---|
| 1 | 设置命名空间从未注册成功 | `settings.register()` / `settings.get()` 在新版已删除 | 设置页不能读写；派发工具读不到固定模型 |
| 2 | 浏览器通道从未注册成功 | 在 `settings` 注入回调的派生上下文上嵌套 `inject(['connection'])`，永不触发 | 客户端 4 个 endpoint 全部 404 |
| 3 | 对等依赖范围过窄 | `^0.1.5-rc.2` 不覆盖 0.2.x | 桌面版插件面板判定「不兼容」 |

问题 1 和 2 都被 `apply` 的 try/catch 吞掉，**不报错、不打日志**，插件行照常 active。
这正是插件文档里写的「静默失效」失败模式，只是它自己也没逃过。

---

## 二、新版机制（读源码确认，非推测）

### 2.1 设置命名空间：由 `Config` 自动投影，不再显式注册

`dsh-settings` 的类注释写明 *"Project Config schemas into forms"*。机制是：

- 插件在入口**导出 `Config`**（schemastery 的 `z` 写），设置页自动出现
- 命名空间名 = **loader 行的 `id`**（不是插件自己命名）
- `describe()` 遍历 loader 条目，凡有 `Config` schema 即生成表单
- 写入走 `settings.update(ns, patch)`，`ns` 即 loader 行 id
- **只有标 `volatile()` 的字段**可被设置页改；标 `volatile` 意为「改了不重载就生效」

官方写法（`dsh-llm-pi-ai`）：

```js
const Config = z.object({ providers: z.dict(profile).default({}).volatile() })
export { Config, apply, inject, name }
// apply(ctx, config) 直接拿到解析后的配置
```

### 2.2 浏览器通道：`registerFetchRoute`，必须与 `settings` 同一次注入

```js
ctx.inject(['settings', 'connection'], (ctx) => {
  ctx.connection.registerFetchRoute(ctx, { path, methods, requestBody, fetch })
})
```

**不能嵌套**：在注入回调的派生上下文上再 `inject(...)`，内层永不触发（已实测）。

### 2.3 对等依赖：只有 `@deepseek-ai/dsh*` 受校验

- 校验函数：`semver.satisfies(runtimeVersion, range, { includePrerelease: true })`
- 只检查名字以 `@deepseek-ai/dsh` 开头的（`cordis`、`schemastery` 不参与）
- 范围需覆盖 `0.1.5-rc.2` ~ `0.2.x`：`>=0.1.5-rc.2 <0.3.0`（已实测全 PASS）

---

## 三、改造方案

### 3.1 配置存储：从「settings 命名空间」改为「插件 Config」

**旧**：`settings.register('superpowers-delegation', schema, { base: {} })`，值存
`~/.dsh/settings.yaml` 的 `superpowers-delegation` 段。

**新**：导出 `Config`，值落在 **profile 的 `cordis.patch.yml`** 里 loader 行的 `config`。

`Config` schema 设计（沿用现有形状，避免破坏现有配置）：

```js
const Config = z.object({
  defaultProvider: z.string().volatile(),
  defaultModel: z.string().volatile(),
  skillModels: z.dict(z.object({
    provider: z.string().required(),
    model: z.string().required(),
  })).volatile(),
}).default({})
```

**命名空间名会变**：从 `superpowers-delegation` 变成 loader 行的 `id`。
现有两行的 id 是 `superpowers-delegation-settings` 和 `superpowers-client`。
建议保留前者作为承载配置的那一行的 id。

### 3.2 配置迁移（必须做，否则用户配置丢失）

`dsh-settings` 的 `LEGACY_SECTION_ENTRIES` 里**没有** `superpowers-delegation` 映射，
所以旧的 `settings.yaml` 不会被自动迁到新行。需要在插件启动时做一次迁移：

- 读 `~/.dsh/settings.yaml`（或 `.imported`）里的 `superpowers-delegation` 段
- 写入新 Config 的对应字段
- 迁移后打日志，便于核对

⚠️ **风险**：`settings.yaml` 已被 DSH 重命名为 `settings.yaml.imported`，
迁移逻辑要兼容这两种状态，并且**幂等**（重复启动不重复写）。

### 3.3 派发工具改读 Config

`lib/skill-delegation.js` 现在用 `ctx.settings.get(NAMESPACE)`（新版不存在）。
改为从注入的 `config` 读，或从 `ctx` 上读当前解析值。

`inject` 也要跟着看是否需要调整（现在是 `['tools', 'subagents', 'settings']`）。

### 3.4 客户端四个 endpoint 保留

`delegation.read` / `delegation.write` / `childModels` / `modelOptions` / `diagnostics`
继续走 `/api/superpowers` 通道，但底层读写改为 Config + `settings.update()`。

`diagnostics` 里的 `settings.namespace` 检查要改写（旧检查项基于已删除的 API）。

### 3.5 对等依赖范围

`"@deepseek-ai/dsh-tools": ">=0.1.5-rc.2 <0.3.0"`（已改好，实测通过）。

---

## 四、影响面

| 文件 | 改动 |
|---|---|
| `lib/index.js` | 主机侧重写：导出 `Config`、一次注入、通道注册、迁移逻辑 |
| `lib/settings-schema.js` | schema 改为 `Config` 形状；`resolveRoute` 保持不变 |
| `lib/skill-delegation.js` | 改读 Config 而非 `ctx.settings.get()` |
| `lib/client.js` | `delegation.read`/`write` 的底层语义变，客户端多半不用改 |
| `scripts/check.mjs` | `diagnostics` 检查项更新；`route.exists` 已加 |
| `package.json` | 对等依赖范围（已改） |
| `AGENTS.md` / `README.md` | 接口事实与兼容说明（已改，需按最终实现复核） |

**不动**：`preset/` 里的 15 个技能、persona、`tool-delegate-skill` 行 ——
`delegate.import` 已实测通过，预设那一半兼容新版。

---

## 五、验证计划（每步都验，不跳过）

1. `npm test` 两套环境
2. 临时端口跑 `scripts/check.mjs`，**逐条看结果**，尤其 `route.exists`
3. **新增**：`settings` 那条要能真的读写（不能只看「注入成功」）
4. 配置迁移：造一份旧格式 `settings.yaml`，启动后核对迁移结果
5. 浏览器侧请用户确认：设置页栏目出现、模型下拉能出值
6. 装到桌面版前，先把上面全跑绿

---

## 六、待你确认的三个点

1. **配置存哪**：改成存 profile 的 patch 里（新版唯一做法），还是希望继续存
   `settings.yaml`？——如果坚持后者，需要另想办法，工作量更大。
2. **命名空间名**：新版里名字取 loader 行 id。现有 id 是
   `superpowers-delegation-settings`，是否要改成更短的名字（比如 `superpowers-delegation`）？
   改名会让旧配置的迁移路径复杂一点，但名实相符。
3. **迁移**：是否需要自动迁移现有 `settings.yaml` 里的配置？
   还是接受「重装后手动重设一次」，把迁移留到以后做？

确认这三点后我再动手。
