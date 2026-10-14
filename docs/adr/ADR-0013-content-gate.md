# ADR-0013 拦截机制：页面内遮罩取代 DNR 重定向

- 状态：已采纳（2026-10-14）
- 取代：ADR-0004、ADR-0008

## 背景

DNR 只能按 `requestDomains` 拦截 main_frame 导航，带来四个问题：

1. 无法区分同一个域名下的内容。例如 `bilibili.com/video/*` 会退化成整个 `bilibili.com`。
2. 已经打开的标签页、单页应用的站内跳转都不会触发拦截。
3. 不知道 UP 主、频道这类页面信号。
4. 重定向会丢掉原始 URL。

## 备选

- A. 继续用 DNR，加上更细的 urlFilter：问题 2 和 3 依然存在。
- B. 在 `tabs.onUpdated` 时用 `tabs.update` 把标签页跳到引导页：问题 3 依然存在，有闪烁，还会丢失页面状态。
- C. **内容脚本遮罩**：在 `<all_urls>` 上于 document_start 注入；向 SW 请求判决后渲染遮罩，并暂停或静音媒体。

## 决策

选 C。

- 判决由 SW 按完整 URL 加频道信号给出，content 只负责渲染。
- 遮罩挂在 `documentElement` 下的 closed shadow root 里，样式与页面隔离。显示期间锁住滚动，并每秒暂停一次 `video` / `audio`（直播会自动续播）。
- 单页应用的跳转靠每秒比较一次 `location.href` 来检测。SW 在状态变化时广播 `policy-changed`，content 另外每 30 秒自己轮询一次作为兜底。
- 安装或更新扩展时，用 `scripting.executeScript` 给已经打开的标签页补注入。

## 后果

- 能做到 URL 级、频道级的拦截，对已打开的页面立即生效，原始 URL 不会丢失。
- 可以用 DevTools 删掉遮罩来绕过。这符合"不对抗自己"的非目标。
- `chrome://`、Chrome 应用商店、扩展页等不能注入脚本的页面不受拦截，这些都不是娱乐场景。
- manifest 去掉 `declarativeNetRequest` 和 `web_accessible_resources`，新增 `scripting`。
