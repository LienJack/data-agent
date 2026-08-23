# U7 Artifact 工作区与同 Hash 预览导出

## Goal

让用户只通过完整、已提交的 `ArtifactReference` 查看表格、图表、Markdown、SQL 与报告，并从同一个 source
revision/hash 派生 CSV/XLSX 下载。预览、报告引用、导出回执和下载字节必须能够反向证明同一内容身份；任何 UI
投影、分页状态或调用方自报 hash 都不能成为第二份 Authority。

## Confirmed Baseline

- `app_data_agent.artifacts` 已保存不可变 revision、canonical `content_hash`、document 与 owning Run；Platform
  `resolveArtifact` 会按完整 ref、scope 与 owning principal 精确读取。
- 通用 Artifact commit 受 active Worker fence 约束，不适合由 Web 伪造导出回执。U7 使用独立 append-only Export
  Receipt Authority，只引用已提交 source ref，不改写 source Artifact。
- U2 已冻结 Workspace/App/Environment/Principal Authority；U7 API 只接受服务端解析的 AppCapability。
- Falcon 数据已经存在，但 Falcon 评分仅是 U1–U20 完成后的最终门禁。本单元不导入任何数据、不运行 Falcon、不调用
  Provider，也不接入 Billing/Pricing/Credit。

## Requirements

1. 新合同定义严格的 renderable Artifact projection、preview response、export command、export receipt/ref/load result，并为
   receipt canonical hash 提供 builder/verifier。
2. 所有入口必须使用完整 `ArtifactReference`。path `artifactId`、capability scope、source document envelope/ref、数据库行与
   receipt 中的 ref 必须逐字段一致；只给 ID、stale revision/hash、cross workspace/run 或未提交 source 均失败关闭。
3. Preview 只从服务端解析的 committed document 生成安全投影；分页/裁剪只影响 viewport，不改变 source ref/hash。
4. Markdown 禁止 raw HTML、script/style/iframe/object/embed/form 与危险 URL；仅允许 `https`/`mailto` 的安全链接。SQL 与
   labels/values 作为文本呈现，不注入 HTML。API 使用 `no-store`、nosniff 与严格 CSP；组件不使用
   `dangerouslySetInnerHTML`。
5. CSV/XLSX 导出只支持严格表格投影。单元格为确定性标量；以 `= + - @`、控制字符或前导空白后公式前缀开头的字符串
   必须按版本化策略可逆中和。Receipt 记录 policy version、format、MIME、filename、row/column count、output byte hash 与
   source ref/hash。
6. XLSX 必须生成真实、最小、确定性的 Office Open XML archive，而不是把 CSV 改扩展名。ZIP entry、XML escaping、cell
   typing 与 metadata 顺序固定；下载 MIME 与 `attachment` filename 固定且禁止 sniffing/inline。
7. Export create 是 idempotent：同 scope/source/format/policy/idempotency key 返回同 receipt；同 key 改 request 失败。
   Receipt 只在服务端重新派生字节并核对 output hash 后提交。
8. Download 必须先加载 exact receipt，再重新读取 exact source、重建字节并核对 output hash；receipt/source 被替换、缺失或
   hash 不一致时不返回任何字节。
9. PostgreSQL 10657 提供 append-only receipt table、source composite FK、canonical request/output hashes、FORCE RLS、immutable
   guard、NOLOGIN owner、backend-only narrow create/load RPC、stable markers 与静态断言。不得给应用角色 direct DML。
10. Web Artifact Workspace 展示 source identity、revision/hash、render kind、安全 preview 与下载动作；SQL history/report cross
    link 传递完整 ref，不复制易漂移 payload。
11. 既有 L2/System Artifact schema 不因未知 document 自动“最佳努力”渲染。只支持显式 adapter；不支持的 artifact type
    返回稳定 `ARTIFACT_PREVIEW_UNSUPPORTED`，原 Artifact 保持可审计。
12. 所有错误只返回稳定码和安全信息，不记录 Artifact raw content、CSV/XLSX bytes、疑似 credential 或 secret。

## Acceptance Criteria

- [x] Contracts 的 strict schemas/builders/verifiers 拒绝 cross-scope splice、stale/source substitution、receipt/output hash
  tamper、unsafe filename/MIME/policy 与非 canonical format。
- [x] 同一 committed Artifact 的 preview、report link、CSV receipt、XLSX receipt 都精确绑定同一 source ref/hash；分页不会
  改变身份。
- [x] Markdown stored-XSS、危险 URL/embed、HTML、SQL/label 注入不会进入可执行 DOM；组件无 raw HTML sink。
- [x] CSV/XLSX 公式注入被可逆中和；真实 XLSX 可被 ZIP/OOXML 解析，固定 MIME/attachment/nosniff；相同输入得到相同字节
  hash。
- [x] create exact replay 不新增行，同 key 不同请求冲突；download 在 exact receipt/source/output 闭合后才返回字节。
- [x] 未提交、错误 revision/hash、cross workspace/run/principal 与 unsupported artifact 全部失败关闭且不创建 receipt。
- [x] 10657 RLS/NOLOGIN/grants/immutable/source FK/canonical hash assertions 通过；应用角色无 direct DML。
- [x] Contracts/Platform/Web focused tests、typecheck/build、renderer/static、fresh PostgreSQL 17、Biome、diff-check 与 forbidden
  scan 全绿。
- [x] scoped commit 只包含 U7 owned paths；无数据导入、Falcon smoke/评分、Provider 调用、Claude/Anthropic 或商业计费路径。

## Out of Scope

- 文件上传/扫描/留存（U10）、Run 控制/恢复（U8）、Research/Report 生成（U6）、真实 Falcon gate（U18）。
- 任意 BI chart grammar、PDF/PNG、编辑 Artifact、对象存储、大文件异步 export、旧数据 backfill 或兼容迁移。
- 把现有 UI projection、SSE payload、客户端 JSON 或 download query 当作内容 Authority。

## Dependencies

- U2 Workspace/Effective Config/Run Authority。
- 已有 committed Artifact Revision 与 PostgreSQL `artifacts` composite identity。
