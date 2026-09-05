# ADR-0002：存储选型——Dexie(IndexedDB) 管数据，chrome.storage 管配置

- 状态：Accepted（2026-09-06）
- 关联：data-model.md

## 背景

两类数据：配置（规则/类别/设置，量小、整体读写）与使用数据（会话明细/日聚合，量大、按日查询、需要事务与 upsert）。

## 决策

- 配置 → `chrome.storage.local`（每类一个 key，整体读写）
- 使用数据 → IndexedDB，经 Dexie 访问；usage_daily 用复合主键 `[date+categoryId+host]` 保证 upsert 幂等
- 计时状态机快照 → `chrome.storage.session`（浏览器重启自动清空，正好匹配"旧段作废"语义）

## 备选与否决

- 全部塞 chrome.storage.local：配额小（默认 10MB 级）、无事务、无索引查询 → 否决
- sessionStorage/localStorage：SW 不可用 → 否决
- 自写 IndexedDB：Dexie 事务/upsert/类型支持成熟，避免手写连接管理 → 采用 Dexie

## 后果

- 扩展页面与 SW 共享 IndexedDB（同 origin），popup 直接查询；代价是改判必须以"事务内双写（明细+聚合）"保持一致性（data-model.md 不变量 3）
