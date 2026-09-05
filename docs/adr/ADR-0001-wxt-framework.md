# ADR-0001：采用 WXT 作为插件框架

- 状态：Accepted（2026-09-06）
- 关联：architecture.md §5

## 背景

需要开发 Chrome MV3 扩展，含 background SW、多个扩展页面、（后续）content script UI。候选：手写 Vite + CRXJS、WXT、Plasmo、纯 webpack 手配。

## 决策

采用 WXT。理由：
- 官方文档明确 MV3/HMR/多入口约定（entrypoints/），`wxt build` 直接产出可加载目录；
- entrypoint 约定（`defineBackground` 自动导入）减少样板；
- 对 Firefox 目标的理论兼容（v1 不做，但留了后路）。

## 后果

- 依赖 wxt 的代码生成约定（`wxt prepare` 生成类型）；构建产物在 `.output/chrome-mv3`
- 唯一风险：WXT 版本迭代快，锁小版本并在 ADR-0006 后记录升级策略
