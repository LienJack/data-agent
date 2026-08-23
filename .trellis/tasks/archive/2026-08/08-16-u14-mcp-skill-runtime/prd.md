# U14 MCP Skill 管理面与 Semantic MCP Runtime

## Goal

建立内容寻址、版本冻结、可治理的 MCP Server/Tool 与 Skill Registry，并让 Run 内 Semantic Tools 复用 U12/U13/Graph/SQL Authority，服从 Effective Config、RBAC、Tool Policy、数据出境投影与外部 Effect 恢复规则。

## Requirements

- 管理面保存 MCP endpoint/SecretRef/manifest/revision/enabled/policy 和 Skill package/dependency/signer/trust/capability/default resource；Revision 不可变且内容寻址。
- 新增 `EXTENSION_MANAGE` Workspace Action；只有 WORKSPACE_ADMIN/SUPER_ADMIN 可创建、替换、发布、启停，ANALYST/VIEWER 只能读取或选择已批准 Revision。
- Run 只消费 U2 Effective Config 冻结的 exact MCP/Skill Revision 与 Tool allowlist；disabled/stale/revoked 不得 latest fallback。
- MCP endpoint 只允许 HTTPS；连接前及每次 redirect 重做 DNS/peer 校验，拒绝 private/link-local/metadata/transition 地址并限制端口、timeout、bytes、redirect。
- Tool dispatch 前必须持久化 Effect Intent，并绑定 TaskCapability、AgentDataProjectionReceipt、Server/Tool Revision、Trust/Audience、classification、allowlist、DLP/mask 与 payload digest。
- ToolEffectSemantics 仅允许 `READ_ONLY`、稳定幂等键的 `IDEMPOTENT_REQUEST`、或带 `OUTCOME_STATUS_QUERY`；未知远端效果进入 `TOOL_OUTCOME_UNKNOWN`，禁止自动重放。
- Skill Revision 不执行安装脚本；未签名、Signer/Publisher 撤销、package/dependency digest 漂移、路径穿越或 fetched bytes 换绑全部隔离。
- `list_metrics/describe_semantic_model/resolve_context/graph_traversal/query` 只适配现有服务，不复制 Context、Graph、Compiler 或 SQL Firewall。
- 本单元不运行 Falcon，不调用真实 Provider/MCP endpoint；网络测试使用可证明零出网或受控 fake transport。

## Acceptance Criteria

- [x] MCP/Skill Revision canonical hash、不可变 replay、同版本异载荷冲突和 disabled/stale selection 全部确定性。
- [x] RBAC/Route/Registry 对 ANALYST/VIEWER mutation、跨 Workspace 与旧 version CAS 失败关闭。
- [x] Effective Config 只冻结 APPROVED+ENABLED exact Revision，历史 Run 可继续解析原 immutable digest。
- [x] SSRF/DNS rebinding/redirect/credential forwarding/敏感参数在网络 dispatch 前拒绝。
- [x] 三类 Effect semantics 覆盖 dispatch 前后崩溃、status reconcile、unknown 不重放。
- [x] 五个 Semantic MCP Tool 与现有 U12/U13/Graph Authority DTO/Receipt parity，无 raw SQL/Cypher/Prompt/Chunk 旁路。
- [x] Contracts、Platform、Worker、Web scoped tests/typecheck/build、Biome、renderer/static、fresh PG17 assertions 全绿。

## Notes

- 对应 G3/G7/G8、M12/M13、R08；依赖 U2/U10/U12/U13。
- U20 只组合已发布 Registry Revision 与 runtime capability，不首次实现 Registry/transport/effect authority。
- 父计划与自动续行指令已批准本单元范围，不再逐单元询问。
- 10665 checksum：`sha256:85673af959d94737fc0893bda362960789607b9af29a321a2c46a7c38955ffae`。
- 浏览器验收覆盖 1440px 管理清单/注册表单、390px Skill 状态与只读角色 mutation 控件完全缺失。
- 全量 Platform 基线仍有共享 U11 foundational-source fixture 失败；U14 Platform focused/surface 共 12/12 通过。
