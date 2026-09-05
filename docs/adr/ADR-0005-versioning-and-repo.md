# ADR-0005：版本化交付策略与仓库纪律

- 状态：Accepted（2026-09-06）

## 背景

目标仓库 https://github.com/T-64/SurfWarden.git 为空仓库；要求 committer 有且仅有 T-64；要求一个版本一个版本迭代，最终交付可运行完整插件。

## 决策

- 版本序列：v0.1.0（追踪+popup）→ v0.2.0（预算+引导页闭环+E2E）→ v0.3.0（规则管理+模板+隐身引导，即 MVP）
- 每版本：DoD 全绿（dev-process §3）→ 打 tag → push；版本内按 implementation-plan 的任务表小步提交
- git identity：仓库级 `user.name=T-64` / `user.email=T-64@users.noreply.github.com`，**不修改全局配置**；每次 push 前 `git log --format='%cn <%ce>' | sort -u` 审计必须只含 T-64
- 分支：单人 + 代理协作，直接 main 提交（tag 即发布物）；引入 PR 流程收益为零

## 后果

- 每个已打 tag 的版本都可独立装入浏览器使用，交付状态始终可回滚
- 若远端仓库已有历史（当前为空），push 前必须 fetch 检查，避免覆盖他人提交
