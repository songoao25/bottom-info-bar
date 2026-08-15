# 贡献指南（Contributing）

感谢你考虑为本项目贡献！以下是指南，请先阅读再提交。

## 如何贡献

### 报告 Bug
- 先搜索 [Issues](https://github.com/songoao25/bottom-info-bar/issues) 是否已存在；
- 新建 Issue 时请包含：复现步骤、期望行为、实际行为、环境信息。

### 提出新功能
- 先在 Issues 中发起讨论，说明用途和场景，避免重复劳动；
- 讨论通过后再实现。

### 提交代码
1. Fork 本仓库并创建功能分支：`git checkout -b feature/xxx`
2. 遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/) 提交规范：
   - `feat: 新功能`
   - `fix: 修复`
   - `docs: 文档`
   - `test: 测试`
   - `chore: 杂项`
3. 提交信息用英文或中文均可，但需清晰描述改动；
4. 通过 Pull Request 提交，描述清楚改动内容和验证方式。

## 开发环境

- 本项目是 DeepSeek Harness 的静态 bundle 插件；
- 主要文件结构：
  - `plugin/src/` — 源码（host.js + client-bundle.js）
  - `plugin/` — npm 包
  - `tests/` — 测试（`node tests/run-all.mjs` 自动先 build 再测）
- 修改源码后需重建：`cd plugin && npm run build`。

## 行为准则

请遵守 [行为准则](CODE_OF_CONDUCT.md)。参与本项目即表示你同意遵守它。

## 许可证

贡献的代码将采用与本项目相同的 [MIT 许可证](LICENSE)。
