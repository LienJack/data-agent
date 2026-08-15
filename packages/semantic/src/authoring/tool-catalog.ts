import {
  type AgentTurnToolDescriptor,
  type SemanticAuthoringToolName,
  semanticAuthoringToolCallSchema,
} from "@data-agent/contracts";
import { z } from "zod";

const descriptions: Readonly<Record<SemanticAuthoringToolName, string>> = {
  list_semantic_types: "列出当前 Graph 注册的 Node 与 Edge 类型。",
  search_semantic_nodes: "按名称和别名搜索候选 Graph 的全部 Node；创建前必须先搜索。",
  read_semantic_node: "读取一个 Node 的精确当前版本。",
  read_semantic_edge: "读取一个 Edge 的精确当前版本。",
  get_semantic_neighborhood: "读取一个 Node 的入边、出边及相邻 Node。",
  read_schema_bindings: "读取主体、维度、公式与物理表列、FK、Join 的显式 Edge。",
  read_formula_dependencies: "读取 Formula 的主体、维度、slots、字段引用与公式依赖 Edge。",
  read_candidate_diff: "读取本次 authoring run 相对 base Graph 的 patch 摘要。",
  create_semantic_node: "在当前 candidate 创建业务主体、维度、指标、公式或术语 Node。",
  update_semantic_node: "以版本和摘要 CAS 更新一个已读取的业务 Node。",
  retire_semantic_node: "以版本和摘要 CAS 退役一个已读取的业务 Node。",
  create_semantic_edge: "在当前 candidate 创建显式 Edge；物理事实 Edge 禁止修改。",
  update_semantic_edge: "以版本和摘要 CAS 更新一个已读取的 Edge。",
  retire_semantic_edge: "以版本和摘要 CAS 退役一个已读取的 Edge。",
  propose_semantic_edge_type: "向 candidate 注册一个 Agent-authored Edge type。",
  validate_semantic_graph: "确定性校验结构、公式与本体关系覆盖，并返回绑定到精确摘要的回执。",
  analyze_semantic_impact: "分析当前 candidate 的 Node、Edge 与下游影响范围。",
  request_semantic_clarification: "发现身份或业务语义歧义时暂停并请求用户选择。",
  complete_authoring_run: "使用精确 Graph 摘要和 validation receipt 结束创作并进入人工审核。",
};

export const SEMANTIC_AUTHORING_TOOL_NAMES = Object.freeze(
  Object.keys(descriptions) as SemanticAuthoringToolName[],
);

const argumentSchemas = new Map<SemanticAuthoringToolName, z.ZodType>(
  semanticAuthoringToolCallSchema.options.map((option) => [
    option.shape.tool_name.value,
    option.shape.arguments,
  ]),
);

export function semanticAuthoringToolArgumentSchema(name: SemanticAuthoringToolName): z.ZodType {
  const schema = argumentSchemas.get(name);
  if (!schema) throw new Error(`Semantic authoring tool schema missing: ${name}`);
  return schema;
}

export function semanticAuthoringToolCatalog(): readonly AgentTurnToolDescriptor[] {
  return SEMANTIC_AUTHORING_TOOL_NAMES.map((name) => ({
    name,
    description: descriptions[name],
    input_schema: z.toJSONSchema(semanticAuthoringToolArgumentSchema(name)) as Record<
      string,
      z.infer<ReturnType<typeof z.json>>
    >,
  }));
}

export function semanticAuthoringModelToolCatalog() {
  return SEMANTIC_AUTHORING_TOOL_NAMES.map((name) => ({
    tool_name: name,
    description: descriptions[name],
    input_schema: semanticAuthoringToolArgumentSchema(name),
    network_access: { mode: "DENY" as const },
  }));
}
