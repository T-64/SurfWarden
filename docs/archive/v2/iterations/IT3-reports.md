# IT3 · v0.6.0 报告与洞察（OpsDeck Dashboard）

## 1. 调研

RescueTime/ActivityWatch 的报告核心是"按日趋势 + 类别构成 + 异常提示"（见 docs/references.md §6）； PRODUCT.md P1 的 F9（报告页）与 F15（正向指标）在 2.0 落地。

## 2. 分析

v0.3.0 启发式 #1（状态可见性）的深层问题：只有"当下"，没有"趋势"。数据层已具备条件——usage_daily 聚合表满足不变量 3（与明细恒等），可直接做趋势与占比；小时分布需要 sessions 明细。**不做**：全天候热力图（需小时级历史聚合表，见 v2-plan 边界）。

## 3. 迭代内容

| 项 | 内容 |
|----|------|
| 指标层 | `src/core/metrics.ts` 纯函数：`lastNDates / aggregateByDate / aggregateByHost / learningToEntertainment / learningStreak / hourBuckets / todayVsWeekAvg`，10 个表驱动测试（总 88 用例） |
| Dashboard 页 | 新 entrypoint `dashboard.html`（OpsDeck 全页）：主指标卡（总时长/学习/娱乐/学习:娱乐/学习连续）、7 日按日堆叠柱状趋势（今日高亮）、类别构成条 + 图例、TOP 站点条形、今日小时分布（按段起始小时归桶，近似已注明）、今日/7日切换 |
| 入口 | popup 底栏「📊 报告」新标签页打开 dashboard；dashboard 头部可跳设置 |
| 截图数据 | shoot.mjs 演示种子升级：7 天历史（含一天学习缺勤）+ 今日 6 段小时级 sessions |

## 4. 验收

- 截图 `docs/images/it3-dashboard.png`：五张主指标卡读数正确；**streak=4 天与种子数据手工推演一致**（09-03 缺勤断档，今天达标 +1）；小时分布桶位与种子时段吻合
- 指标层测试：88/88 通过；`npm run compile` ✓ `npm run build` ✓
- 数据一致性：dashboard 只读聚合表，不变量 3 由 v0.1 事务写入保证
