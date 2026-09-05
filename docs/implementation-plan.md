# 实施方案（Implementation Plan）

> 三个版本逐个交付，每个版本满足 dev-process.md §3 的 DoD 才打 tag。版本内任务分解即提交计划。
> 进度（2026-09-06）：✅ v0.1.0（wildcard/regex 提前在 T4 完成，U1 随之完结）｜✅ v0.2.0（U1–U9，E2E 全闭环 PASS）｜✅ v0.3.0（W1–W5，MVP 完成）

## v0.1.0 —— 装上自用：知道"我今天都干嘛了"（对应 PRODUCT.md M0+M1）

范围（PRODUCT.md F1 + F4 极简版）：

| 任务 | 内容 | 提交 |
|------|------|------|
| T1 | WXT 脚手架 + tsconfig + vitest 接入 + 目录骨架 | chore: |
| T2 | core：types.ts + datetime.ts（dateKey/cutoff）+ 测试 | feat(core): |
| T3 | core：tracker 状态机 + key-algorithms §1.3 边界表全用例 | feat(core): |
| T4 | core：urlMatch 最小版（domain/path/exact）+ 表驱动测试 | feat(core): |
| T5 | adapters：Dexie db + configStore 默认值写入 | feat(adapters): |
| T6 | background：事件接线 + 心跳 + storage.session 快照 | feat(background): |
| T7 | popup 极简版：今日各类别时长列表 | feat(popup): |
| T8 | DoD：单测全绿 + wxt build + 真机冒烟 + tag v0.1.0 | chore(release): |

验收：挂机计时误差可接受（E2/E3 用例保证语义）、重启不丢已闭合数据、popup 与 IndexedDB 一致。

## v0.2.0 —— 监督闭环：预算、横幅、引导页、豁免、学习目标（对应 M2）

范围（F2/F3/F7）：

| 任务 | 内容 |
|------|------|
| U1 | core：urlMatch 补全 wildcard/regex + 优先级打平用例 |
| U2 | core：budget 状态 + 日切 + 豁免上限（纯函数 + 测试）|
| U3 | background：budgetHost 检查点（segment 关闭后重算）|
| U4 | adapters：dnr.ts 动态规则 + web_accessible_resources 声明 |
| U5 | guide 引导页：今日统计 + "去学习"（学习目标跳转）+ 豁免按钮 + 倒计时豁免恢复 |
| U6 | content：nudge 横幅（80% 提醒 / 连续 30min 提醒，shadow DOM）|
| U7 | popup：环形图 + 一键改判 + 暂停 30 分钟 + badge 余量 |
| U8 | E2E 冒烟（Playwright persistent context）：装扩展→刷满预算→断言重定向 guide→豁免→恢复 |
| U9 | DoD + tag v0.2.0 |

## v0.3.0 —— MVP 完整：规则管理、模板、隐身引导（对应 M3）

| 任务 | 内容 |
|------|------|
| W1 | options：规则/类别/预算/学习目标 CRUD，模板包一键导入 |
| W2 | 隐身：isAllowedIncognitoAccess 检测 + 欢迎页图文引导 + badge 小黄点 |
| W3 | 数据导出 JSON / 清空 / 90 天 sessions 清理 |
| W4 | 零网络请求红线检查脚本 + README（安装/使用/隐私）|
| W5 | 全量回归（单测+E2E）+ 真机自测一日 + tag v0.3.0 + push |

## 明确延后（P1+，见 PRODUCT.md §4）

意图打卡、UP 主信号、报告 dashboard、专注模式、新标签页替换、AI 兜底接口。
