# ADR-0010：2.0 设计系统「哨站 OpsDeck」——选型与个性注入

- 状态：Accepted（2026-09-06，IT1/v0.4.0）
- 关联：docs/v2-plan.md、docs/v2-product-audit.md（启发式 #8 主要缺陷）

## 背景

用户对 v0.3.0 的直接反馈："前端太丑、太单调，要有个性"。调研结论（见 references 追加节）：
- 公认审美基准集中在 [Linear / Raycast / Arc / Vercel](https://www.reddit.com/r/ArcBrowser/comments/1n05kvz/looking_for_apps_with_ui_like_notion_arc_and/)；
- [awesome-design-md](https://github.com/VoltAgent/awesome-design-md) 把这些审美做成了可引用的 DESIGN.md 规格，其中 [Raycast 的规格](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/raycast/DESIGN.md) 提供了完整的色值/尺度体系（四级表面阶梯、发丝线、零阴影、8px 间距、白色唯一 CTA）。

## 备选

1. **Linear 暗色 + 紫色强调**：精致但已被无数 SaaS 复制（搜索结果明确指出 Linear 风格被大规模效仿），缺少"自己的个性" → 否决为主方案
2. **全终端/CRT 拟物**：个性最强但易疲劳、易廉价 → 否决
3. **Raycast 骨架 + 自有语义信号色**（采用）：纪律来自经过验证的体系，个性来自与产品语义强绑定的设计语言

## 决策：「哨站 OpsDeck」

骨架（引 Raycast 规格）：
- 表面阶梯：canvas `#0b0c0e` → surface `#131518` → elevated `#1a1d21` → card `#20242a`；发丝线 `#262b31`（1px）；**零投影**，深度只靠表面提亮
- 文本：ink `#f2f4f7` / body `#c9ced6` / mute `#8b929c` / faint `#565d68`
- 主 CTA：白色实心（黑字），半径 8px；控件圆角 4/8/10px 三档
- 间距 8px 基准（2/4/8/12/16/24/32）

个性注入（SurfWarden 签名，每屏克制使用）：
- **信号色 = 语义**：信号绿 `#3ddc84`（学习/放行/正向）、信号琥珀 `#ffb224`（警告）、信号红 `#ff5c5c`（娱乐/封锁/危险）；灰阶界面中只有这三处允许饱和色
- **仪表读数**：所有时长/数字用 `ui-monospace` 等宽 + tabular-nums，小字号大字距标签全大写
- **键帽徽章**：Raycast 式键帽样式用于类别徽章与统计片段（4px 圆角、上亮下暗微渐变）
- **点阵网格**：canvas 层 24px 点阵（2% 透明度），只出现在 guide 页与 dashboard 头部——"哨站雷达"的隐喻
- 类型阶梯：Display 20/600 · Heading 15/600 · Body 13/400 · Caption 11/500 大写 + 0.08em 字距

## 后果

- 三页面（popup/guide/options）与后续 dashboard 共享同一份 `theme.css` 令牌与组件类，视觉一致性由系统保证（启发式 #4）
- 白色 CTA + 语义信号色的组合让"正确的那条路"在界面里永远最醒目（引导页主按钮=信号绿）
- 现有 React 组件只改样式层与结构类名，行为不动——降低 IT1 回归风险
