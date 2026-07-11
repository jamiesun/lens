# lens

Lens 是一个个人使用、运行在浏览器内的前端 Agent Runtime。它通过 Side Panel 提供统一交互，通过结构化页面协议和受控工具理解自有业务系统、协助填写表单并执行经过确认的业务操作。

## 当前状态

已完成 **M0 Page Observer + M1 Form Fill + M2 Agent Loop**：

- Chromium Manifest V3 + Side Panel；默认权限仅 `activeTab` / `scripting` / `sidePanel` / `storage`，模型域名使用按来源申请的可选权限。
- 站点访问默认随 `activeTab` 一次性授权；可在「页面信息」抽屉把 HTTPS 或本机回环站点升级为可撤销的长期授权，切换标签页后 Agent 仍可访问。
- 常驻页面 Agent 按需注入，响应快照与填写两类受控命令。
- 提取标题、摘要、表单、字段、动作、表格和告警的精简语义快照；默认过滤密码、隐藏字段和敏感值。
- 表单填写走原生 setter + 事件派发（兼容受控组件），逐字段返回回执；敏感、只读、禁用、隐藏字段一律拒绝，陈旧快照整体拒绝并提示重扫。
- 用户可配置 OpenAI-compatible 模型；API Key 经 PBKDF2-SHA256 + AES-GCM 加密后写入本地，解锁密钥只保留在浏览器会话中。
- Side Panel 采用聊天优先界面；页面分析、手动表单和工具日志收进二级抽屉，不干扰日常对话。
- 原创 Lens 对焦环标识同时用于 Side Panel 与浏览器扩展图标，不使用第三方产品视觉符号。
- Agent 接受连续的自然语言目标，只能调用运行时注册的 `page.snapshot`、`page.form.fill` 与 `page.screenshot`；工具过程默认折叠。
- 对话历史保存在本机 IndexedDB，可重开、切换和删除；最多保留 30 个会话。
- 支持当前视口截图和整页长图；长图分段捕获并拼接，完成后恢复页面滚动位置与悬浮元素，可在对话中预览和下载。
- 真实 Chromium 扩展 E2E 覆盖页面授权、填写落值、陈旧快照拒绝、加密配置、锁定恢复和完整模型工具循环。

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
