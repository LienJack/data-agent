# Journal - lienli (Part 1)

> AI development session journal
> Started: 2026-07-25

---

## 2026-07-26：U5 Unit 2 — ACL-first Grounding 与 Typed IR

- 从旧 Text2SQL Characterization 固定 QueryContract 输入与差异边界，新增
  Grounding Authority、ACL Snapshot、Join Closure、SemanticQuery、LogicalPlan 和
  Artifact Projection。
- PostgreSQL Repository 新增 Grounding Authority / L2 Artifact 的内容寻址提交与
  解析；候选文档必须在同一事务内通过服务端 Committer、Scope、Principal、上游与
  语义核验，才允许获取 Run Fence 并替换 Active Revision。
- Codex 对抗复审先后复现并关闭限定列跨表漂移、Metric/Dimension 跨类型同名、公开
  Branch Schema 绕过、重复 Retrieval Hit、重复 Measure 与重复 Policy Predicate
  等反例；所有修复均落在共享 Contract，而不是只修某一个调用点。
- 验证：根级 Lint 195 files、Build 5/5、Typecheck 8/8、Unit 466/466、
  Contract 45/45、Text2SQL Security 5/5 通过；最终三路 Codex 复审均未发现
  剩余 P0/P1。
- 边界：本单元不包含 PostgreSQL Compiler、七道 Gate、Repair、Sandbox，也尚未组合
  面向普通 ANALYST 的受信 PolicyReceipt Issuer。下一步继续 U5 Compiler + Gate。
