# IT1 · v0.4.0 设计系统「哨站 OpsDeck」

## 1. 调研

- 公认审美基准：[Linear / Raycast / Arc / Vercel](https://www.reddit.com/r/ArcBrowser/comments/1n05kvz/looking_for_apps_with_ui_like_notion_arc_and/)（社区共识），[Linear 风格拆解](https://www.youtube.com/watch?v=uaLeHKCJqCI)（暗色极简 SaaS 的来源与泛滥）
- 设计规格来源：[awesome-design-md](https://github.com/VoltAgent/awesome-design-md) 的 [Raycast DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/raycast/DESIGN.md)——四级表面阶梯、发丝线、零阴影、白色唯一 CTA、8px 间距、键帽
- 备选否决：Linear 紫（被大规模复制，无个性）、CRT 终端拟物（易疲劳易廉价）——见 ADR-0010

## 2. 分析（基线审计摘要）

基线截图 `docs/images/baseline-{popup,guide,options}.png`：纯白、无层次、控件默认外观、三页面风格各自为政。对应 Nielsen 启发式 **#8 美学与极简** 主要缺陷 + #4 一致性缺陷（详见 `docs/v2-product-audit.md`）。

## 3. 迭代内容

| 项 | 内容 |
|----|------|
| 设计令牌 | 新增 `src/shared/theme.css`：表面阶梯 4 级、发丝线、文本 4 级、语义信号色（绿/琥珀/红）、等宽读数、圆角三档、组件类（od-card/btn/key/pill/meter/row/table/input） |
| Popup | 全量重做：品牌字标（SURF**WARDEN** 绿色点缀）、**记录中/待机实时状态胶囊**（新，启发式 #1）、当前段卡片（站名+实时时长+一键改判）、紧凑仪表（环形图中心 `3:34` 等宽时钟 + TODAY）、预算仪表（状态色语义化：绿/琥珀/红）、TOP 站点等宽字体行 |
| 引导页 | 点阵雷达背景（哨站隐喻）+ CHECKPOINT 键帽标签 + 40px 等宽仪表读数（`1:02 / 0:45`）+ **正路/侧路**信息架构（信号绿主按钮=去学习；豁免降为侧路 ghost） |
| Options | 页面级暗色主题映射到主题令牌（组件逻辑零改动）：暗色表格/输入框/按钮、大写小字 caption 段落标题 |
| nudge 横幅 | 对齐 OpsDeck（暗面板 + 琥珀 NUDGE 标签） |
| 色板迁移 | 默认类别色迁移到 OpsDeck 色板（学习 #3ddc84 / 工作 #57c1ff / 娱乐 #ff5c5c / 中性 #8b929c），`ensureDefaults` 做一次性颜色迁移（自定义类别不动） |

## 4. 验收

- 截图对比：`baseline-*` vs `it1-*`（见 `docs/images/`）——层次、一致性与个性均有代际差异；信号色只出现在语义处
- Nielsen 复查：#8（美学）△→✓；#4（一致性）△→✓；#1（状态可见）△→✓（记录中胶囊+当前段卡片）
- 门禁：`npm run compile` ✓ · `npm run build` ✓ · 69/69 单测 ✓ · 隐私红线 ✓
