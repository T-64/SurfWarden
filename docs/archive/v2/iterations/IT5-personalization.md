# IT5 · v0.8.0 个性化与打磨

## 1. 调研

Raycast/Linear 类产品的"个性"不止皮肤：主题变体（accent color）+ 渐进式引导（progressive onboarding）。用户上轮反馈的"单调"一半来自"没有我是谁的感觉"——主题色是最低成本的所有权（ownership）来源；onboarding 清单对应启发式 #10（帮助与文档）缺失。

## 2. 分析

- 新用户首次打开 options 有 7 个区块无引导 → 加"初始设置"完成度卡（4 步：隐身授权/学习目标/监督档位/模板导入），从配置状态自动计算，无需用户打卡；
- 主题变体通过 CSS 变量覆盖实现（`[data-accent]`），零组件改动；语义不变——变体只替换"正向信号色"，红/琥珀警示色保持（安全语义不可换肤）。

## 3. 迭代内容

| 项 | 内容 |
|----|------|
| 主题变体 | settings.accent（signal/cyan/violet/amber）+ theme.css `[data-accent]` 变量覆盖；popup/guide/dashboard/options 四页根节点接入；options 行为参数内下拉即时生效 |
| 初始设置清单 | options 首屏：4 步完成度进度条 + 逐项 ✓/○（从 incognito/targets/rules/cats 状态推导） |
| 打磨 | popup 版本号改由 manifest 动态读取；dashboard accent 空值安全；privacy 检查保持通过 |

## 4. 验收

- 截图 `docs/images/it5-options.png`：初始设置清单（1/4 进度）、规则表"目录组：社交/视频/开发…"徽章、主题强调色下拉全部在位
- 门禁：compile ✓ build ✓ 91/91 ✓ privacy ✓
