# Production Q&A Team Runtime

## Goal

移除 production Team runtime stub，让 Q&A Run 通过三专职 Agent 的真实受治理工作流产出 accepted AnalysisReport。

## Requirements

- Worker 注入真实 `DataAgentProductTeamRuntimePort`，不得返回固定 unavailable。
- 通过 `PostgresTeamRunStore` 持久 root/child task、handoff、context epoch、completion、verifier 和 acceptance。
- Semantic 已满足时真实记录 SKIPPED，不写 Candidate；需要维护时才调用 semantic ports。
- Text2SQL 使用冻结 Effective Config/Resolved Context，调用 Provider、Compiler、Firewall/Sandbox，产出 QueryEvidence。
- Report 只读取 accepted evidence，调用 Provider/Projector 产出带引用的 AnalysisReport。
- 每个 durable transition 后发 Agent status；Tool 前后事件完整，失败时零伪成功。
- QueryEvidence、SqlArtifact、AnalysisReport 等可查看产物先提交 Artifact Store，再把完整 `ArtifactReference` 写入对应 Tool terminal event，供 Inline file link 与 Inspector 预览。
- deterministic task/attempt/handoff IDs 支持 lease retry、snapshot loss 和 idempotent replay。

## Acceptance Criteria

- [ ] 当前 E-commerce Q&A 真实执行并返回数据库表数量的有证据回答。
- [ ] Team Trace 至少含 root、Text2SQL、Report；Semantic 含 SKIPPED receipt/status。
- [ ] Text2SQL/Report 的公开 Tool 终结事件引用真实已提交 Artifact；点击后现有 Preview API 可按 exact reference 读取，失败时不回退为 raw Tool output。
- [ ] Profile stale、context drift、tool denial、provider failure、lease takeover 全部失败关闭。
- [ ] Worker restart/replay 不重复 Provider/Tool side effect，最终 Acceptance 唯一。
