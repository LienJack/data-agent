# 浏览器验收证据

日期：2026-08-22，Next development server，Chromium via `agent-browser`，页面仅在非 production 暴露。

## 1440 × 900

- 搜索 `SQL_TIMEOUT`：input value 正确，记录 DOM `1`，命中文案 `1 命中`，时间轴 opacity=1 节点 `1`。
- timeline sequence 1 获得键盘焦点后按 ArrowRight，list `aria-current=step` 与 Inspector 同步到 sequence 2。
- Result 页签展示“沙箱在 30 秒限制内未完成”；Timing 页签展示 `SESSION_TIMESTAMPS`。
- separator 键盘调整 `aria-valuenow`；关闭 Inspector 后焦点返回 sequence 43 触发行。
- Run 泳道 pointer drag 后记录 DOM 从 `80` 变为 `35`；WheelEvent 缩放后为 `64`；双击重置恢复 `80`。
- 11 个状态均出现在 timeline `aria-label`：QUEUED/RUNNING/WAITING/COMPLETED/FAILED/CANCELLED/PENDING/INTERRUPTED/SKIPPED/BLOCKED/AVAILABLE。
- `document.documentElement.scrollWidth > innerWidth` 为 `false`。
- 截图：`/tmp/resolution-trace-content-1440.png`。

## 390 × 844

- `document.documentElement.scrollWidth > innerWidth` 为 `false`。
- Inspector box `{x:0,y:715.25,w:390,h:100.75}`，确认窄屏转为底部纵向区，不制造页面横向溢出。
- 截图：`/tmp/resolution-trace-content-390.png`。

## 10,000 nodes

- URL：`/dev-resolution-trace-preview?nodes=10000`。
- Toolbar 显示 `10000 节点`；完整 model 可搜索。
- record DOM=`80`；timeline DOM=`1200`；显示聚合提示；document overflow=`false`。
- 搜索 `阶段 10000`：record DOM=`1`，精确行 `TERMINAL · 阶段 10000 #10000`，时间轴仍保留同一 matched node。
- 点击唯一行后 `aria-current=step` 与 Inspector heading 都是 `TERMINAL · 阶段 10000`。
- 截图：`/tmp/resolution-trace-10k.png`、`/tmp/resolution-trace-10k-search.png`。

浏览器 console 只有 React DevTools development info，`agent-browser errors` 无页面错误。
