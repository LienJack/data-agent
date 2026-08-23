# Q&A Readiness Bootstrap Technical Design

## Boundaries

新增独立的本地/demo CLI 和可测试 orchestrator。CLI 只负责环境解析、显式确认和结构化输出；
orchestrator 通过现有端口组合 readiness，不直接操作受治理表。

```text
explicit local CLI
  -> resolve workspace AppCapability
  -> resolve/create three role-owned model profile revisions
  -> SchemaDiscoveryService.startScan(ecommerce datasource)
  -> EffectiveConfigResolver.updateWorkspaceDefaults(CAS)
  -> materializeBuiltinTeamProfiles
       -> SkillRegistry.commit x9
       -> AgentProfileRegistry.commit x3
  -> read back exact readiness projection
```

前端错误流独立：

```text
non-2xx Response
  -> parse bounded standard error envelope
  -> ApiRequestError(status, code, retryable, public message)
  -> QA store renders message + code
  -> malformed/non-JSON response uses status-only fallback
```

## Authority And Data Flow

1. CLI 从现有本地环境读取 deployment/tenant/principal/database binding，只接受 `local`/非 production 和
   `DATA_AGENT_ALLOW_QA_READINESS_BOOTSTRAP=YES`。
2. 使用 `PostgresCapabilityAuthority.resolveForServerContext(..., WRITE)` 获得 workspace capability；所有后续
   port 共用该 capability 和 transactional authorizer。
3. 从当前 workspace datasource、active semantic pointer、authenticated system model 和 builtin policy RPC
   读取权威输入。缺少任一输入时 fail closed，不猜测 ID。
4. Product Profile 需要三个隔离的 Model refs。orchestrator 为每个 specialist 解析稳定 role-owned catalog entry；
   缺失时通过 Model Control Repository 从一个已认证 system model 派生非用户默认的实际 revision。稳定 ID、
   payload 与 idempotency 保证重复执行只重放。生产入口不暴露此行为。
5. Schema scan 复用 workspace datasource resolver、egress、secret resolver、PostgreSQL connector 和 snapshot
   store。若相同 idempotency 已完成则复用同一 snapshot。
6. Defaults 绑定 role-independent Q&A 选中模型、E-commerce datasource、active semantic release、成功 snapshot
   与三个 builtin policy refs。当前 revision 已精确匹配时跳过 CAS；否则只以正确 expected revision 更新。
7. `materializeBuiltinTeamProfiles` 使用实际 role model refs和由 builtin policy + specialist identity 生成的稳定
   content-addressed context/safety refs，先 Skill 后 Profile。所有 operation ID 和 idempotency key 均确定性生成。
8. 完成后重新读取 Profiles、Defaults、Snapshot，只有完整集合满足时输出 `READY`。

## Compatibility

- Q&A route、Team lease 和 production Registry 语义不变。
- 未运行 CLI 的 workspace 仍返回现有稳定错误。
- API client 新错误类型兼容现有 `Error` 消费者；已有只读取 `message` 的 UI 无需迁移。
- 不修改迁移或直接回填历史 workspace。

## Failure And Atomicity

- Schema scan、Defaults、Skill/Profile 各自已有事务边界，跨端口流程不能成为单个数据库事务。
- orchestrator 采用单向可重放步骤；任何中间失败输出已完成 step 与稳定 reason code，重跑从权威 read-back
  继续，不撤销 immutable revisions。
- Profile 激活必须最后执行，避免 Profiles READY 但 Snapshot/Defaults 不可用。
- 模型派生、Defaults CAS 和 Registry receipts 使用确定性 identity；冲突表示输入漂移，必须 HOLD。

## Rollback

- 代码回滚只移除独立 CLI/orchestrator 和前端错误投影；不会影响现有 run route。
- 已创建的 immutable local revisions保留审计；如需停用，必须走 Profile Registry lifecycle command，禁止删表。
- 本任务不自动执行生产 rollback 或删除任何本地数据。

## Tests

- Orchestrator unit：步骤顺序、缺输入零后续写、Profile 最后激活、read-back、幂等重跑。
- Integration：fresh PostgreSQL fixture 中 schema/defaults/profile readiness 完整闭环。
- Web：标准 JSON error、malformed JSON、空 message/status fallback。
- Browser：同 workspace 发起问题，验证 POST 不再是 readiness 400，并核对页面显示真实错误。
