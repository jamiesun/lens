# 快速开始

本章介绍如何在本地开发、测试和打包 Lens 本身。如果你只是想让自己的业务前端接入 Lens 的工具协议，直接跳到[页面工具开发指南](./page-tools-guide.md)，不需要读这一章。

## 环境要求

- Node.js（建议与 CI 一致的 24.x）
- Chromium（WXT 会在 `npm run dev` 时自动下载并启动一个开发用的 Chromium 实例）

## 安装与开发

```sh
npm install
npm run dev
```

WXT 会打开已加载 Lens 的 Chromium。点击浏览器工具栏中的 Lens 图标打开 Side Panel，然后选择 **SCAN PAGE**。

## 开发验收模式

```sh
npm run dev:test
```

该命令会启动测试业务页和本地 mock OpenAI-compatible 端点，再以 test 模式加载扩展并自动打开测试页，同时保留 WXT 热更新。test 模式仅额外授权 `127.0.0.1`，不会改变生产清单。模型测试配置使用 `http://127.0.0.1:4173/mock-openai/`、任意模型名和 API Key `lens-test-key`；按 <kbd>Ctrl+C</kbd> 会同时关闭 WXT 和测试页服务。

## 测试

```sh
npm run compile     # TypeScript 类型检查
npm test            # Vitest 单元测试
npm run test:e2e    # 构建 e2e 产物 + Playwright 端到端测试
npm run check        # compile + test + build 一次跑完
```

新增或修改一级业务能力时，必须同步补齐单元测试与端到端测试，并更新[验收矩阵](./roadmap.md)——这是仓库的硬性规定，不是建议。

## 构建与打包

```sh
npm run build
npm run package
```

`npm run build` 生成可直接加载的解压扩展目录 `.output/chrome-mv3`；`npm run package`（即 `wxt zip`）生成 `.output/lens-<version>-chrome.zip`，用于分发或上传应用商店。

## 发布

仓库使用基于 Git tag 的发布工作流（`.github/workflows/release.yml`）：

1. 在 `package.json` 里把 `version` 改成目标版本号，提交到 `main`。
2. 打一个匹配的 tag 并推送，例如：

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. GitHub Actions 会重新跑一遍完整校验（类型检查、单元测试、构建、端到端测试），构建打包产物，并把 tag 和 `package.json` 版本号做一致性检查——不一致会直接失败，避免发布内容与版本号错位。校验全部通过后，工作流会创建一个 GitHub Release，附带 `lens-<version>-chrome.zip`，并自动生成变更说明。

发布只产出可下载的扩展包，不会自动提交应用商店；如果需要上架 Chrome Web Store，仍然是手动从 Release 里下载 zip 提交审核。
