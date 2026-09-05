# 开发流程约束（Dev Process）

> 本文档是 SurfWarden 项目的"宪法"：所有实现工作必须遵守。灵感来源：Claude Code / Codex 类编码代理的工程实践（spec 先行、小步提交、测试门禁、ADR 记录决策），结合本项目"单人 + 代理协作"的实际。参考来源见 `docs/references.md`。

## 1. 总原则

1. **文档先行**：任何功能动笔前，必须先有对应的设计文档（架构 / 数据模型 / 关键算法）与实施范围；实现过程中发现的偏差回写到文档，而不是让文档腐烂。
2. **ADR 记录所有非显而易见的决策**：每条 ADR 记录 背景 → 备选方案 → 决策 → 后果。决策被推翻时**不修改旧 ADR**，而是新增 ADR 引用旧编号说明修订原因——这样 ADR 链就是决策演化史。
3. **版本化迭代**：语义化版本（0.x），每个版本对应一个可安装、可自测的增量。版本完成 = 打 tag + push，不允许"半成品 tag"。
4. **每一行代码可控**：核心逻辑（计时、匹配、预算）一律纯函数 + 依赖注入，不依赖全局 `chrome.*`；依赖清单受控，新增依赖必须先立 ADR。

## 2. 分层架构约束

```
src/core/     纯逻辑层：types、tracker 状态机、ruleEngine、budget —— 禁止 import chrome/*，vitest 全覆盖
src/adapters/ 适配层：chrome.* API、Dexie、storage 的薄封装 —— 只做 IO 转发，不含业务判断
entrypoints/  WXT 入口层：background / popup / guide / options —— 组装 core + adapters，含 UI
```

规则：**业务判断只允许出现在 core**；adapter 出 bug 修 adapter，算法出 bug 修 core，禁止互相渗透。

## 3. 测试门禁（Definition of Done）

每个版本交付前必须全部满足：

- [ ] `npm run test`（vitest）全绿，core 层行覆盖目标 ≥ 90%（用 `vitest run --coverage` 抽查核心文件）
- [ ] `npm run build`（wxt build）成功产出 `.output/chrome-mv3`
- [ ] 新增/变更算法行为有对应表驱动测试用例（先写用例再写实现）
- [ ] 文档同步：ADR（如有新决策/修订）、受影响的设计文档章节
- [ ] git 审计：`git log --format='%cn <%ce>' | sort -u` 输出**仅** `T-64 <T-64@users.noreply.github.com>`
- [ ] 真实浏览器冒烟：`npm run build` 产物装入 Chrome，走一遍本版本验收路径

E2E（Playwright + persistent context + `--load-extension`，见 references.md）自 v0.2.0 起纳入门禁。

## 4. 提交纪律

- Conventional Commits：`docs:` / `feat:` / `fix:` / `test:` / `chore:` / `refactor:`，一次提交只做一件事
- git identity 用**仓库级配置**（不碰全局）：`user.name=T-64`，`user.email=T-64@users.noreply.github.com`
- tag 格式 `vX.Y.Z`，打在版本完成提交上，tag 信息含该版本 DoD 核对结果摘要
- push 前必须跑第 3 节门禁

## 5. 风险最高的三个技术点（实现顺序上优先攻）

1. MV3 service worker 随时被杀 → 计时引擎必须"事件驱动 + 心跳水位 + 宽限截断"（见 key-algorithms.md §1，ADR-0003）
2. 隐身窗口覆盖 → 检测 + 引导（PRODUCT.md §3.7）
3. DNR 动态规则重定向到扩展页 → `redirect.extensionPath` + `web_accessible_resources`（见 references.md §3）
