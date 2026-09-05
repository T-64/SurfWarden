# ADR-0004：封锁用 declarativeNetRequest 动态规则重定向，而非 content script 遮罩

- 状态：Accepted（2026-09-06；规则 id 分配与 URL 传递细节在 v0.2 实现时以 ADR-0008 固化）
- 关联：key-algorithms.md §3.2、references.md §3

## 背景

预算耗尽后要阻止用户继续访问该类别站点。候选：content script 全屏遮罩；`chrome.tabs` 监听后重定向；declarativeNetRequest (DNR) 动态规则。

## 决策

DNR `updateDynamicRules` + `redirect.extensionPath`（重定向到 `/guide.html`）：

- 在页面请求阶段（`main_frame`）拦截，页面 JS/network 都不发生，无闪现原站内容
- 声明式规则由浏览器执行，**不依赖 SW 存活**——SW 被杀也不放行
- 前提（官方文档查证）：guide 页必须列入 `web_accessible_resources`；`redirect` 需 host 权限（本项目 `<all_urls>`）

## 后果

- 规则跨会话持久：加/移规则必须与预算状态严格同步（key-algorithms §3.2 生命周期；data-model 不变量 5），SW 启动时要对账（getDynamicRules vs 当前预算状态，补齐差异）
- 原始 URL 传递：`extensionPath` 不支持 query，v0.2 用 `redirect.url` + `chrome.runtime.getURL('guide.html?url=…')` 实现（ADR-0008）
- 豁免 = 临时移规则 + alarm 定时恢复，需防止期间 usedSec 继续增长导致的重复加/移抖动
