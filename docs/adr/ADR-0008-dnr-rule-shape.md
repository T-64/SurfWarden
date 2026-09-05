# ADR-0008：DNR 封锁规则的具体形态——每（类别 × 域名）一条规则 + 引导页带域名根查询

- 状态：Accepted（2026-09-06，v0.2 U4 实现时）
- 修订对象：ADR-0004（其中"规则 id 分配与 URL 传递细节在实现时固化"即本文）

## 背景

ADR-0004 决定用 DNR 动态规则重定向到 `/guide.html`。实现时发现两个细节问题：

1. **redirect.url 是编译进规则的**：无法在每次导航被拦时动态携带真实目标 URL。引导页想知道"你本来要去哪"，只能靠规则里写死的信息。
2. **规则 id 必须稳定且唯一**：`updateDynamicRules` 按 id 增删，id 不稳定会导致残留规则放行封锁站点。

## 决策

- **粒度**：每（封锁类别 × 域名）一条规则。`condition.requestDomains: [domain]`（天然匹配子域）+ `resourceTypes: ['main_frame']`。
- **id**：`hash(categoryId + '#' + domain)` 的稳定 31 位哈希；同批内碰撞则换盐重散列（确定性）。全量重算时批量 diff，天然去重。
- **原始 URL 传递**：`redirect.url = chrome.runtime.getURL('guide.html') + '?cat=<catId>&url=https://<domain>/'`。引导页的豁免按钮放行后跳**域名根**，不做深链接续跳（DNR 的静态性所限，接受此取舍；豁免后用户重新点书签即可）。
- **域名提取**：规则的 pattern 为 domain/path/wildcard 形态时取其 host 段（domain=`twitter.com`→`twitter.com`；`bilibili.com/video/*`→`bilibili.com`）。exact/regex 形态不参与域名封锁（无法可靠提取），仅统计。
- **全量重算**：每次预算检查点计算"期望规则全集"，与 `getDynamicRules()` 现状做 diff，`updateDynamicRules({ removeRuleIds, addRules })` **单次原子调用**。SW 启动时也重算一次（对账，见 ADR-0004 后果第 1 条）。
- **豁免**：从期望集中临时去掉该类别 → 重算；`alarms` 定时（exemptMinutes）后再重算恢复。豁免窗口内继续累积的用量在恢复时自然再次触发封锁。
- **日切**：不特判——新的一天 usage 从零开始，检查点重算后期望集自然为空。

## 备选与否决

- 每类别一条规则 + `requestDomains` 多域合并：省规则数，但 redirect.url 无法带域名（同问题 1）→ 否决
- redirect.extensionPath（无 query）：引导页完全不知道目标 → 否决
- content script 遮罩：页面已加载、依赖 SW 存活 → ADR-0004 已否决
- 监听 webRequest 记录"被拦 URL"：declarativeNetRequest（非 withLogging）无回调，且不想引入 host 权限之外的开销 → 否决

## 后果

- guide.html 必须列入 `web_accessible_resources`（matches `<all_urls>`），否则重定向报错（官方文档确认）
- 域名根跳转在 site 有 SEO 跳转时行为正常；带 path 的深链接豁免后需用户自行回到（写入引导页文案）
