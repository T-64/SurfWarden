# IT4 · v0.7.0 专注与意图

## 1. 调研

one sec 的"意图时刻"（打开前询问）、Forest/专注会话的"限时锁定"、RescueTime 的 FocusTime（封锁分心站并静默提醒）。共同点：**专注期是"无例外时间"**——任何豁免通道都会摧毁其可信度。

## 2. 分析

v0.2 的引导页已承载"意图三选"的信息架构（正路=去学习 / 侧路=豁免或关闭，IT1 完成视觉分层），本次不堆叠同义按钮，而是补齐缺失的**专注模式**与三处一致性：
1. popup 缺"一键进入无干扰状态"的入口（用户原话场景：学德语时不想被推特打断）；
2. 专注期如果还能从引导页豁免，专注形同虚设；
3. nudge 横幅没有预算进度读数（IT1 审计 #1 遗留）。

## 3. 迭代内容

| 项 | 内容 |
|----|------|
| 专注核心 | `focusBlocks(action, focusUntil, now)` 纯函数（nudge/budget 档专注期无条件封锁；hard 本就封、track 永不封）+ `exemptAllowedDuringFocus`（专注期禁豁免），5 个用例 |
| background | `sw-focus {minutes}` / `sw-focus-end` 消息；focusUntil 存 settings（SW 重启不丢）；`sw-focus-end` alarm + 消息双通道恢复；**专注期横幅静默**（不打断心流） |
| popup | 专注行：30′/45′/60′ 一键进入；专注中显示剩余分钟 + 结束按钮 |
| 引导页 | 专注期顶部"🎯 专注中 · 剩 N 分"胶囊（信号绿），**隐藏豁免按钮**，去学习入口保持畅通 |
| nudge | 横幅内嵌琥珀色迷你进度条（预算消耗比） |
| 回归 | blocking E2E 全链路复跑 PASS（network 抖动改用 about:blank 闭合段，去外网依赖） |

## 4. 验收

- 截图 `docs/images/it4-popup.png`：专注中胶囊（剩 22 分）+ 结束按钮 + 报告入口 + v0.7.0 全部在位
- 截图 `docs/images/it4-guide.png`：紧凑仪表 `1:10 / 0:45`
- 门禁：compile ✓ build ✓ 91/91 单测 ✓ blocking E2E PASS ✓
