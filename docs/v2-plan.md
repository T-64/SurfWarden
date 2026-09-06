# SurfWarden 2.0 迭代总规划（五轮迭代 → v2.0.0）

> 流程：每轮 = **调研 → 分析 → 迭代 → 验收**（截图留档 `docs/images/`，记录 `docs/iterations/ITn-*.md`，ADR 按需新增）。
> 依据：用户对 v0.3.0 的反馈——"基础功能有了但很一般；前端太丑、太单调，要有个性的产品；功能要向成熟监督工具看齐（如 Cold Turkey 的默认分组/自动归类）"。

## 五轮迭代主题

| 轮 | 版本 | 主题 | 核心交付 | 验收方式 |
|----|------|------|---------|---------|
| IT1 | v0.4.0 | **设计系统重塑「哨站 OpsDeck」** | 全新的暗色精密仪器风格：表面阶梯/发丝线/等宽数字/键帽徽章/点阵背景，popup+guide+options 全部重做 | 前后截图对比（baseline-* → it1-*），Nielsen 启发式复查 |
| IT2 | v0.5.0 | **站点情报（对标 Cold Turkey 分组）** | 内置站点目录（常用站的分组/标签先验）、自动匹配归类、未分类站点建议流、组预算 | 单测 + popup"待归类"卡片截图 + E2E |
| IT3 | v0.6.0 | **报告与洞察** | 新增 dashboard：今日时间线、7 日趋势、类别占比、小时热力图、学习 vs 娱乐比值、streak | dashboard 截图 + 数据一致性断言（聚合=明细） |
| IT4 | v0.7.0 | **专注与意图** | 专注模式（N 分钟封锁全部娱乐）、引导页意图三选（继续/学习/关掉）、nudge 横幅重设计 | E2E：开专注→娱乐站被拦；引导页截图 |
| IT5 | v0.8.0 | **个性化与打磨** | 主题强调色可选、新手引导清单（onboarding checklist）、全面启发式复查与细节打磨 | 全量回归 + 终版截图集 |
| 终 | **v2.0.0** | 发布 | manifest 升 2.0.0，全量验收（七项门禁 + 三套 E2E + 截图集） | 交付总结 |

## 设计方向（结论，详见 ADR-0010）

**「哨站 OpsDeck」**：以 Raycast 的暗色单色纪律为骨架（四级表面阶梯 + 1px 发丝线 + 零阴影 + 白色主 CTA），注入 SurfWarden 自己的个性——
- **信号色只属于语义**：绿=学习/放行、琥珀=警告、红=娱乐/封锁，其余界面保持灰阶；
- **等宽数字**：所有时间数字用 tabular mono，像仪表读数；
- **键帽徽章**与**点阵网格背景**作为签名装饰（每屏最多一处）；
- 一句话气质：**一台盯着你的黑色仪器，读数清晰，不怒自威。**

来源：[awesome-design-md 的 Raycast DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/raycast/DESIGN.md)（逐条色值/尺度引用）、Linear/Raycast/Arc/Vercel 作为公认基准的社区共识、[Linear 设计拆解](https://www.youtube.com/watch?v=uaLeHKCJqCI)。

## 产品分析方法（详见 v2-product-audit.md）

以 [Nielsen 10 可用性启发式](https://www.nngroup.com/articles/ten-usability-heuristics/) + [Eleken 的 UX 审计清单](https://www.eleken.co/blog-posts/a-checklist-for-ux-design-audit-based-on-jakob-nielsens-10-usability-heuristics) 为框架对 v0.3.0 做启发式评估；竞品机制对照 [Cold Turkey 用户指南](https://getcoldturkey.com/support/user-guide/)（block lists=分组、例外页签、分组日程）。
