# Semantic Studio 与 Explorer

> 当前语义前端只有 Workspace-scoped Studio 与 Explorer；不存在全局入口或旧 Data Link 适配层。

## 路由与所有权

- 可写入口：`/w/:workspaceId/semantic`。
- 只读入口：`/w/:workspaceId/semantic/explorer`。
- Studio 需要 `SEMANTIC_EDIT`；Explorer 只需要 `WORKSPACE_RESULT_READ`。只读用户不得被迫获得语义
  写权限，也不得看到指向无权访问 Studio 的返回入口。
- `/semantic/*`、`/data-link/*` 与 `/w/:workspaceId/data-link/*` 不得存在 route 或 redirect；由
  Next.js 默认返回 404。
- Route 必须把显式 `workspaceId` 传给 component/controller/API client。不得从 pathname、storage
  或全局 store 恢复语义工作空间身份。

## 状态与 Authority

- Controller/reducer 持有 server snapshot、selection、draft、typed manual edits、SSE event sequence、
  connection、save conflict 与 publish lifecycle。
- SSE 以服务端 sequence 为水位线：重复事件去重，低水位批次不得覆盖新状态，重连继续使用当前
  cursor；terminal 后关闭连接。
- Workspace 改变必须重建 controller，清除 draft、selection、SSE、error、evidence selection 与
  未保存 edit。
- Direct Editor 与 Studio 只产生经 strict schema 校验的 `SemanticManualEdit` command；显式 Save
  才形成 Candidate Revision。浏览器不产生 Release authority，也不 autosave。
- Explorer 是 PostgreSQL published release 的只读投影；Candidate 只可作为明确标记的 comparison。
- Context Preview 使用 Workspace READ capability 和只读 `ResolvedContextPreviewResult`；展示 exact release lexical evidence，澄清选择只留在本地且不产生 Receipt/Candidate/Run。
- Binding Impact 只读取 `semantic-binding-impact-safe-projection@1.0.0`；Explorer 可从 `domain + impactId` 深链展示 counts/risk/action/reason/release，并复用 exact Candidate comparison，不能读取 plan/package/drift payload 或执行治理写入。

## UI 状态与可访问性

- Studio 明确呈现 loading、empty、error、read-only、editing、saving、save-conflict、
  ready-to-publish、publishing、published。
- Explorer 明确呈现 domain loading/error、snapshot empty/error/success、permission denied 与辅助查询
  error。
- 交互控件必须具备 label/`aria-label`、focus-visible 与 disabled 状态；异步状态通过 `role=status`、
  `role=alert` 或 `aria-live` 公布。
- 390px 视口不得横向溢出；大图保持 bounded DOM，选中对象始终保留在渲染窗口。

## 必需验证

- Reducer 测试覆盖 Workspace reset、SSE replay/stale/reconnect、save conflict 与 publish transition。
- Route 静态测试证明旧文件、redirect、store、mock auth 均不存在。
- Web unit、typecheck 与 production build 必须通过；build manifest 不得出现旧入口。
