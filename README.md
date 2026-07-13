# lens

Lens 是一个个人使用、运行在浏览器内的前端 Agent Runtime。它通过 Side Panel 提供统一交互，通过结构化页面协议和受控工具理解自有业务系统、协助填写表单并执行经过确认的业务操作。

## 当前状态

已完成 **M0 Page Observer + M1 Form Fill + M2 Agent Loop**：

- Chromium Manifest V3 + Side Panel；默认权限仅 `activeTab` / `scripting` / `sidePanel` / `storage`，模型域名使用按来源申请的可选权限。
- 站点访问默认随点击工具栏图标一次性授权（`action.onClicked` 手动打开面板，确保 activeTab 真正授予；面板已开时再次点击会就地重新授权并重扫）；可在「页面信息」抽屉把任意 HTTP(S) 站点升级为可撤销的长期授权，切换标签页后 Agent 仍可访问。
- 常驻页面 Agent 按需注入，响应快照、填写与点击三类受控命令。
- 提取标题、摘要、表单、字段、动作、表格和告警的精简语义快照；无按钮语义但带点击示能（cursor: pointer / onclick）的元素以 `clickable` 动作收录；默认过滤密码、隐藏字段和敏感值。
- 表单填写走原生 setter + 事件派发（兼容受控组件），逐字段返回回执；敏感、只读、禁用、隐藏字段一律拒绝，陈旧快照整体拒绝并提示重扫。
- 受控页面点击派发真实指针事件序列并绑定当前快照身份；表单提交按钮与声明为 server-write/destructive/financial 的元素由运行时直接拒绝。
- 用户可配置 OpenAI-compatible 模型；API Key 经 PBKDF2-SHA256 + AES-GCM 加密后写入本地，解锁密钥只保留在浏览器会话中。
- Side Panel 采用聊天优先界面；页面分析、手动表单和工具日志收进二级抽屉，不干扰日常对话。
- 输入区使用可扩展的“+”入口，首个能力支持附加受限大小的文本、代码与数据文件；文件内容仅随本次请求发送给用户配置的模型，本地历史只保留文件名、类型和大小。
- 原创 Lens 对焦环标识同时用于 Side Panel 与浏览器扩展图标，不使用第三方产品视觉符号。
- Agent 接受连续的自然语言目标，只能调用运行时注册的 `page.snapshot`、`page.form.fill`、`page.click` 与 `page.screenshot`；工具过程默认折叠。
- 自有业务页面可通过 Lens Page Tools v1 私有协议注册结构化工具：页面发布 `window.__lensPageToolsV1` 注册表，运行时在 MAIN world 读取并整体校验，observe / local-write 工具以 `site_` 前缀进入模型工具列表，server-write 及以上风险两层拒绝，页面刷新后旧会话调用失效。
- 对话历史保存在本机 IndexedDB，可重开、切换和删除；最多保留 30 个会话。
- 支持当前视口截图和整页长图；长图分段捕获并拼接，完成后恢复页面滚动位置与悬浮元素，可在对话中预览和下载。
- 真实 Chromium 扩展 E2E 覆盖页面授权、填写落值、页面点击、陈旧快照拒绝、加密配置、锁定恢复、页面工具注册与风险拦截和完整模型工具循环。

### 页面接入（Lens Page Tools v1）

自己开发的业务前端加入如下注册代码后，Lens 会在 Agent 运行时自动发现并优先使用这些结构化工具：

```js
window.__lensPageToolsV1 = {
  version: 1,
  sessionId: crypto.randomUUID(),
  tools: new Map(),
};
window.__lensPageToolsV1.tools.set('inventory_lookup', {
  name: 'inventory_lookup', // 小写 snake_case，最多 16 个工具
  description: '按关键字查询库存条目。',
  risk: 'observe', // observe | local-write 会被执行；更高风险当前一律拒绝
  inputSchema: {
    type: 'object',
    properties: { keyword: { type: 'string' } },
    required: ['keyword'],
    additionalProperties: false,
  },
  execute: async (input) => queryInventory(input.keyword), // 返回可 JSON 序列化的结果
});
```

约束：工具声明非法（命名、风险值、Schema 或数量超限）时整个注册表被拒绝；`execute` 结果必须是 JSON 可序列化值且默认 10 秒超时；页面刷新后注册表随会话 ID 重建，旧调用自动失效。协议 Schema 见 `src/protocol/page-tools.ts`。

完整目标、非目标和能力方向见 [`docs/roadmap.md`](docs/roadmap.md)。

## 开发

```sh
npm install
npm run dev
```

WXT 会打开已加载 Lens 的 Chromium。点击浏览器工具栏中的 Lens 图标打开 Side Panel，然后选择 **SCAN PAGE**。

### 开发验收模式

```sh
npm run dev:test
```

该命令会启动测试业务页和本地 mock OpenAI-compatible 端点，再以 test 模式加载扩展并自动打开测试页，同时保留 WXT 热更新。test 模式仅额外授权 `127.0.0.1`，不会改变生产清单。模型测试配置使用 `http://127.0.0.1:4173/mock-openai/`、任意模型名和 API Key `lens-test-key`；按 `Ctrl+C` 会同时关闭 WXT 和测试页服务。

```sh
npm run check
npm run test:e2e
```

### 构建与打包

```sh
npm run build
npm run package
```

`npm run build` 生成可直接加载的解压扩展目录 `.output/chrome-mv3`；`npm run package` 生成用于分发或上传应用商店的 ZIP 包。

## 质量与验收

所有一级业务能力都必须满足 [`docs/roadmap.md`](docs/roadmap.md#验收矩阵业务能力覆盖矩阵) 中的覆盖底线：至少具备 Happy Path E2E；高风险能力还必须覆盖失败路径、权限边界以及状态修改失败后的恢复或回滚。新增一级能力时必须同步更新验收矩阵，否则变更不完整。
