# SurfWarden（冲浪监督）

本地优先的浏览器插件：自动记录你每天在什么网页上花了多少时间，用**内容级规则**区分"刷 B 站"和"B 站学德语"，并通过预算、提醒、引导页监督你——**拦下走神之后，把你带回去该去的地方**。

> v2.0 = 「哨站 OpsDeck」设计系统 + 站点情报 + 报告洞察 + 专注模式。五轮迭代全过程见 [docs/iterations/](docs/iterations/) 与 [docs/images/](docs/images/)。

## 特性（v2.0.0）

- ⏱ **准确计时**：active tab + 系统 idle/锁屏检测；MV3 后台休眠不虚增（心跳水位 + 宽限截断，ADR-0003）；隐身窗口照常统计
- 🧭 **内容级规则**：域名 / 路径通配 / 完整 URL / 正则，更具体的规则永远赢——`live.bilibili.com → 娱乐` 与 `B站德语课 → 学习` 共存
- 🧠 **站点情报**：内置 61 常用站目录（组/标签先验），未分类站点在 popup 一键采纳为规则（ADR-0011）
- 🎯 **预算监督**：类别预算 → 80% 横幅（带进度读数）→ 超额重定向到引导页（"去学习"主按钮一键跳回课程）
- 🪙 **豁免机制**：引导页"再来 5 分钟"，每天限次，如实计入数据
- 🎯 **专注模式**：30/45/60 分钟封锁全部可监督类别，专注期禁豁免、横幅静默
- 📊 **OpsDeck 报告**：7 日堆叠趋势、类别构成、TOP 站点、小时分布、学习 : 娱乐比值、学习连续天数、今日 vs 周均值
- 🎨 **个性外观**：哨站暗色设计系统（表面阶梯/发丝线/等宽仪表读数/键帽徽章/点阵雷达背景）+ 四套主题强调色
- 🔒 **全本地**：零网络请求、无账号；数据只在 IndexedDB + chrome.storage，支持 JSON 导出

## 安装（自用，无需上架）

```bash
npm install
npm run build          # 产出 .output/chrome-mv3
```

Chrome/Edge → 扩展管理 → 开发者模式 → 加载已解压的扩展 → 选 `.output/chrome-mv3` 目录。

> 开发模式：`npm run dev` 自动打开浏览器并热更新。

## 首次使用

1. 扩展管理页 → SurfWarden → 详情 → 打开**允许隐身模式**
2. 点扩展图标看今日统计；设置页（详情页 → 扩展程序 → 详细信息里，或 popup 右上角）配置规则/预算/学习目标
3. 种子规则已内置常见站点（Twitter/B站/YouTube/直播站 → 娱乐；Coursera/LeetCode → 学习）

## 开发

```bash
npm run compile       # 类型检查（wxt prepare + tsc）
npm test              # vitest 单测（core 层行覆盖 >94%）
npm run build         # 生产构建
npm run smoke         # 真机冒烟（Edge，需本机装 Microsoft Edge）
npm run e2e:block     # E2E：预算→引导页→豁免→放行 全链路
npm run check:privacy # 隐私红线：源码零网络 API
```

## 文档

- [产品方案](docs/PRODUCT.md)（定位/概念模型/功能清单/里程碑）
- [开发流程约束](docs/dev-process.md)（分层/门禁/提交纪律）
- [架构设计](docs/design/architecture.md) / [数据模型](docs/design/data-model.md) / [关键算法](docs/design/key-algorithms.md)
- [实施计划](docs/implementation-plan.md) 与 [ADR 决策记录](docs/adr/)（0001–0009，含迭代与修订史）
- [权威参考笔记](docs/references.md)（WXT / Playwright / DNR / Dexie 查证结论）

## 隐私

- 除浏览器本地存储外**零网络请求**（`npm run check:privacy` 是发布门禁的一部分）
- 隐身窗口数据同样只存本机——这是本插件的设计目的（监督自己的隐身浏览），开启授权时会明确提示
- 卸载扩展即删除全部数据（数据都在扩展自己的存储里）
