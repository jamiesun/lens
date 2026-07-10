# lens

Lens 是一个个人使用、运行在浏览器内的前端 Agent Runtime。它通过 Side Panel 提供统一交互，通过结构化页面协议和受控工具理解自有业务系统、协助填写表单并执行经过确认的业务操作。

## 当前状态

首个可运行切片 **M0 Page Observer** 已完成：

- Chromium Manifest V3 + Side Panel 扩展骨架。
- 使用 `activeTab` 临时权限按需注入页面观察脚本。
- 提取标题、摘要、表单、字段、动作、表格和告警的精简语义快照。
- 默认过滤密码、隐藏字段和敏感值，并展示本地工具调用轨迹。
- 通过真实 Chromium 扩展 E2E 验证授权与拒绝两种页面访问状态。

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

该命令会先启动 `http://127.0.0.1:4173/customer-create.html` 测试页，再以 test 模式加载扩展并自动打开测试页，同时保留 WXT 热更新。test 模式仅额外授权 `127.0.0.1`，不会改变生产清单。点击工具栏中的 Lens 图标即可扫描；按 `Ctrl+C` 会同时关闭 WXT 和测试页服务。

```sh
npm run check
npm run test:e2e
```

## 质量与验收

所有一级业务能力都必须满足 [`docs/roadmap.md`](docs/roadmap.md#验收矩阵业务能力覆盖矩阵) 中的覆盖底线：至少具备 Happy Path E2E；高风险能力还必须覆盖失败路径、权限边界以及状态修改失败后的恢复或回滚。新增一级能力时必须同步更新验收矩阵，否则变更不完整。
