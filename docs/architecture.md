# 架构与工程约束

本章面向想要理解 Lens 内部如何运作的读者：维护 Lens 本身的人，以及想知道"我注册的工具在被谁、如何调用"的业务前端开发者。

## 项目边界（不可协商）

这些约束写在仓库的 `AGENTS.md` 里，任何改动都必须先修改这份文档并说明理由，而不是绕开它们：

- Lens 是**个人使用、本地优先**的浏览器前端 Agent Runtime，不是通用自主浏览器代理。
- 除非用户明确修改项目边界，否则不引入新的 Agent 服务端、多租户、计费、团队权限或集中式密钥托管系统。
- **模型只能提出结构化工具调用**；权限、风险、确认、审计和执行结果必须由受控运行时裁决——模型不能直接执行任何东西。
- 不提供任意 JavaScript 执行、任意网络请求，或默认覆盖所有网站的万能能力。

这些边界直接决定了 Page Tools 协议的形状：业务前端只能**声明**工具和它们的风险等级，真正"要不要执行"的决定权始终在 Lens 运行时手里，页面自称风险低不会让运行时把执行权交出去。

## 运行时的三层结构

```text
Side Panel UI  ──typed messages──▶  Agent Runtime（background）
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
            内置页面工具           Page Tools（site_*）      模型 Provider
      page.snapshot / page.form.fill   业务前端注册的         用户自己的
      page.click / page.screenshot     结构化工具            API Key 直连
```

- **内置页面工具**：`page.snapshot`（语义快照）、`page.form.fill`（受控表单填写）、`page.click`（受控点击）、`page.screenshot`。这些工具面向任意网页，靠 DOM 语义猜测意图，是没有结构化协议时的通用兜底。
- **Page Tools（`site_*`）**：业务前端通过 `window.__lensPageToolsV1` 主动声明的结构化工具，见[页面工具开发指南](./page-tools-guide.md)。当页面提供了它们，模型会被明确告知优先使用，因为它们比 DOM 猜测更准确、更高效。
- **模型 Provider**：用户在设置里配置的 OpenAI-compatible 端点；API Key 经 PBKDF2-SHA256 + AES-GCM 加密后存储在本地，解锁密钥只留在浏览器会话内存中，Lens 不代理、不留存对话内容到任何服务端。

## 工具注册表与风险门禁

Agent Runtime 内部维护一张运行期工具绑定表，而不是散落各处的 `if/switch`：每个工具名映射到一个执行绑定和一个风险等级。这带来两个直接后果：

1. **内置工具和 Page Tools 走同一套门禁逻辑**——风险判定不会因为工具来源不同而有例外。
2. **风险等级的判定权在 Lens 侧，不在页面侧。** Page Tools 发现阶段，运行时用 `PAGE_TOOLS_ALLOWED_RISKS`（当前是 `observe` 和 `local-write`）过滤：
   - 允许的风险 → 生成模型可见的工具定义，加 `site_` 前缀。
   - 不允许的风险（`server-write` / `destructive` / `financial`）→ **不出现在模型看到的工具列表里**，但仍然记录在绑定表中，标记为 `blocked`。
   - 如果模型因为幻觉硬调用了一个从未展示过的工具名，绑定表里的 `blocked` 标记会在真正派发前再拦一次——这是故意的双重阻断，而不是信任"模型看不到就不会调用"这一个假设。

## 权限模型

- 默认权限仅 `activeTab` / `scripting` / `sidePanel` / `storage`；模型域名按来源申请可选权限。
- 站点访问随点击工具栏图标一次性授权；可在"页面信息"抽屉把任意 HTTP(S) 站点升级为可撤销的长期授权。
- Page Tools 复用同一套页面访问权限——没有独立的授权流程，业务前端不需要也无法为 Page Tools 单独申请权限。

## 事件流与可观测性

运行时通过一串带类型的 `AgentEvent` 把过程暴露给 Side Panel（工具事件默认折叠，不干扰日常对话）。Page Tools 相关的两个事件名是排查问题时要认的关键字：

- `page.tools.list` —— 每次 Agent 运行发现阶段产生一次，`completed` 时带 `"N/M page tools available"`，`failed` 时带具体原因（版本不兼容、Schema 非法等）。
- `page.tools.call` —— 每次实际派发一次 `site_*` 工具调用产生一次。

详细的错误码和失败原因见[页面工具开发指南 · 错误码参考](./page-tools-guide.md#7-错误码参考)。

## 验收矩阵是硬性规定

每个一级业务能力必须至少有一条 Happy Path E2E；高风险能力必须覆盖失败路径；涉及权限的功能必须验证至少两种角色/访问状态；修改系统状态的操作必须验证失败后的恢复或回滚。新增一级能力时必须同步更新[验收矩阵](./roadmap.md#验收矩阵业务能力覆盖矩阵)，否则改动视为不完整。这条规则本身也在 `AGENTS.md` 里，是 CI 之外靠人和 review 强制执行的部分。
