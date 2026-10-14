# IT2 · v0.5.0 站点情报（对标 Cold Turkey 分组）

## 1. 调研

[Cold Turkey 用户指南](https://getcoldturkey.com/support/user-guide/)：其"分组"= block lists，组内混合网站/应用、组级例外页签、（Pro）组级日程；但**新站点仍需手动归组**。社区（[r/coldturkeyblocker](https://www.reddit.com/r/coldturkeyblocker/comments/1jw93oi/feature_suggestions/)）对分组的诉求集中在"多组管理"。

## 2. 分析

用户痛点原话："一个网站过来了以后会有一些匹配，类似于分组和 tag 先自动识别"。我们已有 Category（预算维度），缺的是**站点先验**：系统应该"认识"常见站。设计取舍见 ADR-0011：目录先验 + 标签展示，**不新建 Group 实体**（避免与 Category 概念重叠，配置翻倍）。

## 3. 迭代内容

| 项 | 内容 |
|----|------|
| 目录 | `src/core/siteCatalog.ts`：内置 61 条常用站（国际+国内，10 个组：社交/视频/直播/开发/学习/新闻/购物/搜索/办公/音乐/游戏），字段 host/name/group/tags/category |
| 匹配 | `lookupCatalog`：www 归一 + 后缀匹配 + **最长 host 优先**（live.bilibili.com 命中"直播"而非"视频"——开发中发现顺序匹配的坑，表驱动测试固化） |
| 建议采纳流 | popup"⚡ 未分类站点"卡：仅当当前段无规则命中（默认类别）且目录可匹配时出现；`[✓ 采纳为规则]` 走新消息 `sw-add-rule` 写入规则（规则优先级永远高于目录）；`[忽略]` 本会话内不再提示 |
| 识别展示 | options 规则表名称列下方显示"目录组：XX"徽章（启发式 #6 识别而非回忆） |
| 测试 | siteCatalog 8 个新用例（匹配/建议/数据卫生：无 www 前缀、无重复、类别合法），总 78 用例 |

## 4. 验收

- 截图 `docs/images/it2-popup.png`：zhihu.com 无规则 → 建议卡「社交 → 娱乐」+ 采纳/忽略；当前段卡片实时时长正常
- 优先级不变量测试保持绿色：显式规则 > 目录建议 > 默认类别
- 门禁：compile ✓ build ✓ 78/78 ✓
