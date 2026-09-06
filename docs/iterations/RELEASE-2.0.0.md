# Release · v2.0.0（五轮迭代终版）

## 交付清单（对应五轮迭代）

| 版本 | 主题 | 迭代记录 | 关键截图 |
|------|------|---------|---------|
| v0.4.0 | IT1 设计系统「哨站 OpsDeck」 | [IT1](IT1-design-system.md) | baseline-* → it1-* |
| v0.5.0 | IT2 站点情报（61 站目录/建议采纳流） | [IT2](IT2-site-intelligence.md) | it2-popup.png |
| v0.6.0 | IT3 报告与洞察（dashboard） | [IT3](IT3-reports.md) | it3-dashboard.png |
| v0.7.0 | IT4 专注与意图 | [IT4](IT4-focus-intent.md) | it4-popup.png |
| v0.8.0 | IT5 个性化与打磨 | [IT5](IT5-personalization.md) | it5-options.png |
| **v2.0.0** | 发布 | 本文档 | final-* 四张全套 |

## 终版验收（全部门禁现场重跑）

- 类型检查 ✓ · **91/91 单测** ✓ · 构建 ✓ · 隐私红线 ✓
- 真机 E2E ×3：smoke（计时链路）PASS · blocking（预算→引导→豁免→放行）PASS · options（分区+模板导入 10→14）PASS
- 终版截图：final-popup / final-guide / final-options / final-dashboard（popup 展示记录中+站点情报+专注中+报告入口全状态）

## 与 v0.3.0 的用户可感知差异

1. 视觉：白色默认控件 → OpsDeck 暗色精密仪器（四页统一 + 四套主题色）
2. 智能：未分类站点自动识别分组并给一键采纳；规则表带目录组徽章
3. 洞察：新增报告页（趋势/构成/分布/比值/streak）
4. 专注：一键 30-60 分钟无例外封锁（豁免禁用）
5. 引导：options 初始设置完成度清单
