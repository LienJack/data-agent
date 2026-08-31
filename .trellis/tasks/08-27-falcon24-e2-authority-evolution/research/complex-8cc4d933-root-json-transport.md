# Root AUTO：约束传输语法，不修补原响应

## 1. 根因分类

B 跨层契约 / D 测试覆盖。AUTO 在应用层要求 native tool 或完整 JSON，但 Mastra 的 AUTO 分支
不启用 structuredOutput，原 DeepSeek wire request 没有 `response_format`。模型提示与传输约束并不等价。
`5d1cf6f0` A3 和 `8cc4d933` A1 后续 Root 都有 `AUTO_RESPONSE_INVALID_JSON`；原响应未持久保留，
无法声称具体是 prose、fence 还是空响应。原 OUTCOME_UNKNOWN 均不重放。

## 2. 之前修复为什么不足

`8cc4d933` 增加输出协议提醒，但无法约束解码输出；新的真实 Run 仍出现该错误。
之前离线测试覆盖合法/非法 AUTO 文本和不执行工具，没有验证 DeepSeek wire 层必须携带 JSON mode。
现用实际固定 Mastra 1.52.1 / DeepSeek SDK 3.0.13，mock 仅替代网络，不替换 SDK 或解析器：6 项先 RED。

## 3. 防复发机制

- 仅 DeepSeek+AUTO+有工具时，在原 model 的 stream/generate 调用参数设 `responseFormat:{type:"json"}`。
  原 SDK 发送 `json_object`；工具仍 auto，真实 fetch 仍在 durable dispatch marker 之后，恰好一次。
- 无 Mastra structuring model、无新输出 schema、无响应修补、无新增 `ai` 生产依赖、无模型或预算变更。
  metadata 保留原 provider/model/specification/supportedUrls，原 SDK 只增加标准 `Return JSON.` 系统前缀。
  原 user/system 消息逐项保留；原 upper-bound 保留的完整 response schema 字节大于该固定前缀。
- 原 fullOutput.text 完整 JSON.parse 与注册 schema 校验不变；空、prose、fence、未知字段仍唯一失败，
  不泄露正文、不新增网络调用、不改变 Provider OUTCOME_UNKNOWN。
- 新用例覆盖无正文 native tool、严格 final JSON、四种非法 final；并核对 exact wire response_format、
  auto tool choice、单工具、thinking disabled、output limit、原消息、一次 fetch、marker 顺序和请求未被修改。
- 四个 Agent Runtime suite 共82项及 typecheck通过。其他 Provider AUTO 和原 REQUIRED 路径回归通过。
- Agent Runtime build后，Worker直连dispatcher/Root loop另46项及Worker typecheck通过；合计128项focused。

## 4. 扩展与限制

这修复请求语法契约，不证明模型总能产生正确语义；官方说明 JSON mode 仍可能空响应，
保留原失败关闭。新构建的真实 A/B 仍须重验，不能把 offline PASS 计为复杂四层 PASS。
SDK 包文档通过临时目录只安装 `ai` 检索；仓库依赖和锁文件未改。该技能没有引入新 Agent 或 Gateway。

一手参考：[DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode/)、
[Chat Completion 参数](https://api-docs.deepseek.com/api/create-chat-completion/)，2026-09-01读取。
实际实现以本仓库固定 SDK 的 `deepseek-chat-language-model.ts` 与
`convert-to-deepseek-chat-messages.ts`、真实 Mastra bridge 离线 wire 断言为证。

## 5. 知识固化

已更新 Root Authority 与 Provider 契约；模板目录不存在。原 A1/A3 失败审计与 NAS 控制面迁移分别保留，
不把两个根因混为同一修复。下一步新 clean 构建、fresh scratch，再验证复杂 A/B。
