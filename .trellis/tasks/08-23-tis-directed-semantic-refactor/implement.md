# 执行计划

1. [x] M0：提交 V2-only 计划基线，删除方案中的兼容/迁移矛盾。
2. [x] M1：新增当前 lexical evidence contract，替换现有 exact-only name/alias 扫描和旧 authority contract。
3. [x] M1 gate：记录 exact、preferred、synonym、abbreviation、ambiguity、unresolved 与稳定性结果；决定 M2
   go/no-go。
4. [x] M3：实现 schema drift → binding impact receipt/Candidate，不修改 drift 事实和 Published Release。
5. [x] M4：把已交付证据接入 Workspace Studio/Explorer，补 Falcon/Test Center 与浏览器验收。
6. [x] 全局清理：`rg` 证明无 V1 runtime/compatibility/legacy semantic path，完成跨层验证和父任务归档。

每一步都执行 Trellis before-dev/check/spec/finish 流程，并创建独立 commit。M2 若 no-go，仅提交门禁记录，
不实现代码。
