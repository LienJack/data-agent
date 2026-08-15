import {
  affectedSemanticGraphEntryIds,
  SEMANTIC_AUTHORING_TOOL_RECEIPT_VERSION,
  type SemanticAuthoringCheckpoint,
  type SemanticAuthoringPublicEvent,
  type SemanticAuthoringState,
  type SemanticAuthoringToolCall,
  type SemanticAuthoringToolReceipt,
  type SemanticAuthoringValidationReceipt,
  type SemanticGraphPatchOperation,
  semanticAuthoringToolCallSchema,
  semanticAuthoringToolReceiptSchema,
  semanticAuthoringValidationReceiptSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { computeSemanticGraphDigest } from "../graph-v2/canonicalize.js";
import { createSemanticGraphPatch } from "../graph-v2/patch-reducer.js";
import { validateSemanticGraph, validateSemanticOntologyCoverage } from "../graph-v2/validator.js";

export class SemanticAuthoringToolError extends Error {
  override readonly name = "SemanticAuthoringToolError";

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface SemanticAuthoringToolExecutionContext {
  readonly new_id: () => string;
  readonly now: () => string;
  readonly compiler_version: string;
  readonly turn_index: number;
}

export interface SemanticAuthoringToolExecution {
  readonly call: SemanticAuthoringToolCall;
  readonly receipt: SemanticAuthoringToolReceipt;
  readonly next_graph: SemanticAuthoringState["working_graph"];
  readonly checkpoint: SemanticAuthoringCheckpoint;
  readonly events: readonly SemanticAuthoringPublicEvent[];
  readonly validation_receipt: SemanticAuthoringValidationReceipt | null;
  readonly requests_clarification: boolean;
  readonly requests_completion: boolean;
}

function normalized(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s_-]+/g, "");
}

function stableEvent(
  state: SemanticAuthoringState,
  context: SemanticAuthoringToolExecutionContext,
  offset: number,
  event: Omit<
    SemanticAuthoringPublicEvent,
    "schema_version" | "event_id" | "run_id" | "sequence" | "occurred_at"
  >,
): SemanticAuthoringPublicEvent {
  return {
    schema_version: "semantic-authoring-public-event@1.0.0",
    event_id: context.new_id(),
    run_id: state.run.authoring_run_id,
    sequence: state.event_sequence + offset,
    occurred_at: context.now(),
    ...event,
  } as SemanticAuthoringPublicEvent;
}

function checkpointWith(
  checkpoint: SemanticAuthoringCheckpoint,
  changes: Partial<SemanticAuthoringCheckpoint>,
): SemanticAuthoringCheckpoint {
  return { ...checkpoint, ...changes };
}

function requirePriorSearch(state: SemanticAuthoringState, name: string): void {
  const sought = normalized(name);
  const search = [...state.checkpoint.searches]
    .reverse()
    .find(
      (entry) =>
        sought.includes(normalized(entry.query)) || normalized(entry.query).includes(sought),
    );
  if (search === undefined) {
    throw new SemanticAuthoringToolError(
      "SEMANTIC_SEARCH_REQUIRED",
      `创建 ${name} 前必须先按名称搜索当前 Graph。`,
    );
  }
  if (search.matched_node_ids.length > 0) {
    throw new SemanticAuthoringToolError(
      "SEMANTIC_IDENTITY_CLARIFICATION_REQUIRED",
      `${name} 存在相似 Node；不得自动合并身份，请读取候选并请求用户澄清。`,
    );
  }
}

function requireReadNode(state: SemanticAuthoringState, nodeId: string): void {
  if (!state.checkpoint.read_node_ids.includes(nodeId)) {
    throw new SemanticAuthoringToolError(
      "SEMANTIC_NODE_READ_REQUIRED",
      `修改 Node ${nodeId} 前必须读取其精确当前版本。`,
    );
  }
}

function requireReadEdge(state: SemanticAuthoringState, edgeId: string): void {
  if (!state.checkpoint.read_edge_ids.includes(edgeId)) {
    throw new SemanticAuthoringToolError(
      "SEMANTIC_EDGE_READ_REQUIRED",
      `修改 Edge ${edgeId} 前必须读取其精确当前版本。`,
    );
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function mutationOperation(call: SemanticAuthoringToolCall): SemanticGraphPatchOperation | null {
  switch (call.tool_name) {
    case "create_semantic_node":
      return { operation: "ADD_NODE", node: call.arguments.node };
    case "update_semantic_node":
      return {
        operation: "UPDATE_NODE",
        ...call.arguments,
        node: {
          ...call.arguments.node,
          node_version: call.arguments.expected_node_version + 1,
        },
      };
    case "retire_semantic_node":
      return { operation: "RETIRE_NODE", ...call.arguments };
    case "create_semantic_edge":
      return { operation: "ADD_EDGE", edge: call.arguments.edge };
    case "update_semantic_edge":
      return {
        operation: "UPDATE_EDGE",
        ...call.arguments,
        edge: {
          ...call.arguments.edge,
          edge_version: call.arguments.expected_edge_version + 1,
        },
      };
    case "retire_semantic_edge":
      return { operation: "RETIRE_EDGE", ...call.arguments };
    case "propose_semantic_edge_type":
      return { operation: "ADD_EDGE_TYPE", ...call.arguments };
    default:
      return null;
  }
}

function enforceMutationPolicy(
  state: SemanticAuthoringState,
  call: SemanticAuthoringToolCall,
): void {
  switch (call.tool_name) {
    case "create_semantic_node":
      requirePriorSearch(state, call.arguments.node.name);
      return;
    case "update_semantic_node":
      requireReadNode(state, call.arguments.node.node_id);
      return;
    case "retire_semantic_node":
      requireReadNode(state, call.arguments.node_id);
      return;
    case "create_semantic_edge": {
      const edge = call.arguments.edge;
      requireReadNode(state, edge.source_node_id);
      requireReadNode(state, edge.target_node_id);
      return;
    }
    case "update_semantic_edge":
      requireReadEdge(state, call.arguments.edge.edge_id);
      return;
    case "retire_semantic_edge":
      requireReadEdge(state, call.arguments.edge_id);
      return;
    case "propose_semantic_edge_type":
      if (call.arguments.edge_type_definition.authoring_policy !== "AGENT_AUTHORED") {
        throw new SemanticAuthoringToolError(
          "SEMANTIC_SYSTEM_MANAGED_MUTATION",
          "Agent 不得注册 system-managed Edge type。",
        );
      }
      return;
    default:
      return;
  }
}

async function validationReceipt(
  state: SemanticAuthoringState,
  context: SemanticAuthoringToolExecutionContext,
): Promise<SemanticAuthoringValidationReceipt> {
  const graphDigest = await computeSemanticGraphDigest(state.working_graph);
  const issues = [
    ...validateSemanticGraph(state.working_graph).map((issue) => ({
      code: issue.code,
      message: issue.message,
      ...(issue.entry_id === undefined ? {} : { subject_id: issue.entry_id }),
    })),
    ...validateSemanticOntologyCoverage(state.working_graph).map((issue) => ({
      code: issue.code,
      message: issue.message,
      subject_id: issue.entry_id,
    })),
  ];
  const material = {
    receipt_version: "semantic-authoring-validation@1.0.0" as const,
    graph_digest: graphDigest,
    compiler_version: context.compiler_version,
    valid: issues.length === 0,
    issues,
  };
  return semanticAuthoringValidationReceiptSchema.parse({
    ...material,
    receipt_digest: await sha256ContentHash(material),
  });
}

async function entryDigestMap(
  entries: readonly (
    | SemanticAuthoringState["working_graph"]["nodes"][number]
    | SemanticAuthoringState["working_graph"]["edges"][number]
  )[],
): Promise<Readonly<Record<string, `sha256:${string}`>>> {
  return Object.fromEntries(
    await Promise.all(
      entries.map(
        async (entry) =>
          [
            "node_id" in entry ? entry.node_id : entry.edge_id,
            await sha256ContentHash(entry),
          ] as const,
      ),
    ),
  );
}

async function readResult(
  state: SemanticAuthoringState,
  call: SemanticAuthoringToolCall,
): Promise<{ readonly result: unknown; readonly checkpoint: SemanticAuthoringCheckpoint }> {
  const graph = state.working_graph;
  switch (call.tool_name) {
    case "list_semantic_types":
      return {
        result: {
          node_types: graph.node_type_registry,
          edge_types: graph.edge_type_registry,
        },
        checkpoint: state.checkpoint,
      };
    case "search_semantic_nodes": {
      const query = normalized(call.arguments.query);
      const allowed = new Set(call.arguments.node_types);
      const nodes = graph.nodes
        .filter(
          (node) =>
            node.lifecycle === "ACTIVE" &&
            allowed.has(node.node_type) &&
            [node.name, ...node.aliases].some((name) => normalized(name).includes(query)),
        )
        .slice(0, call.arguments.limit);
      return {
        result: { nodes },
        checkpoint: checkpointWith(state.checkpoint, {
          searches: [
            ...state.checkpoint.searches,
            { query: call.arguments.query, matched_node_ids: nodes.map((node) => node.node_id) },
          ],
        }),
      };
    }
    case "read_semantic_node": {
      const node = graph.nodes.find((entry) => entry.node_id === call.arguments.node_id) ?? null;
      return {
        result: {
          node,
          entry_digest: node === null ? null : await sha256ContentHash(node),
        },
        checkpoint: checkpointWith(state.checkpoint, {
          read_node_ids: unique([...state.checkpoint.read_node_ids, call.arguments.node_id]),
        }),
      };
    }
    case "read_semantic_edge": {
      const edge = graph.edges.find((entry) => entry.edge_id === call.arguments.edge_id) ?? null;
      return {
        result: {
          edge,
          entry_digest: edge === null ? null : await sha256ContentHash(edge),
        },
        checkpoint: checkpointWith(state.checkpoint, {
          read_edge_ids: unique([...state.checkpoint.read_edge_ids, call.arguments.edge_id]),
        }),
      };
    }
    case "get_semantic_neighborhood": {
      const edges = graph.edges
        .filter((edge) => {
          if (call.arguments.direction === "IN")
            return edge.target_node_id === call.arguments.node_id;
          if (call.arguments.direction === "OUT")
            return edge.source_node_id === call.arguments.node_id;
          return (
            edge.source_node_id === call.arguments.node_id ||
            edge.target_node_id === call.arguments.node_id
          );
        })
        .slice(0, call.arguments.limit);
      const nodeIds = unique(
        edges.flatMap((edge) => [edge.source_node_id, edge.target_node_id, call.arguments.node_id]),
      );
      const nodes = graph.nodes.filter((node) => nodeIds.includes(node.node_id));
      return {
        result: {
          nodes,
          edges,
          node_entry_digests: await entryDigestMap(nodes),
          edge_entry_digests: await entryDigestMap(edges),
        },
        checkpoint: checkpointWith(state.checkpoint, {
          read_node_ids: unique([...state.checkpoint.read_node_ids, ...nodeIds]),
          read_edge_ids: unique([
            ...state.checkpoint.read_edge_ids,
            ...edges.map((edge) => edge.edge_id),
          ]),
        }),
      };
    }
    case "read_schema_bindings": {
      const edges = graph.edges.filter(
        (edge) =>
          (edge.source_node_id === call.arguments.node_id ||
            edge.target_node_id === call.arguments.node_id) &&
          [
            "REPRESENTED_BY",
            "IDENTIFIED_BY",
            "BOUND_TO",
            "REFERENCES",
            "CONTAINS_COLUMN",
            "FOREIGN_KEY_TO",
            "SUPPORTED_BY",
            "JOINABLE_VIA",
          ].includes(edge.edge_type),
      );
      const nodeIds = unique(edges.flatMap((edge) => [edge.source_node_id, edge.target_node_id]));
      const nodes = graph.nodes.filter((node) => nodeIds.includes(node.node_id));
      return {
        result: {
          edges,
          nodes,
          node_entry_digests: await entryDigestMap(nodes),
          edge_entry_digests: await entryDigestMap(edges),
        },
        checkpoint: checkpointWith(state.checkpoint, {
          read_node_ids: unique([...state.checkpoint.read_node_ids, ...nodeIds]),
          read_edge_ids: unique([
            ...state.checkpoint.read_edge_ids,
            ...edges.map((edge) => edge.edge_id),
          ]),
        }),
      };
    }
    case "read_formula_dependencies": {
      const formula = graph.nodes.find(
        (node) => node.node_id === call.arguments.formula_node_id && node.node_type === "FORMULA",
      );
      const edges = graph.edges.filter(
        (edge) =>
          edge.source_node_id === call.arguments.formula_node_id &&
          ["REFERENCES", "DEPENDS_ON", "AT_GRAIN", "USES_DIMENSION"].includes(edge.edge_type),
      );
      const nodeIds = unique([
        call.arguments.formula_node_id,
        ...edges.map((edge) => edge.target_node_id),
      ]);
      return {
        result: {
          formula: formula ?? null,
          edges,
          formula_entry_digest: formula === undefined ? null : await sha256ContentHash(formula),
          edge_entry_digests: await entryDigestMap(edges),
        },
        checkpoint: checkpointWith(state.checkpoint, {
          read_node_ids: unique([...state.checkpoint.read_node_ids, ...nodeIds]),
          read_edge_ids: unique([
            ...state.checkpoint.read_edge_ids,
            ...edges.map((edge) => edge.edge_id),
          ]),
        }),
      };
    }
    case "read_candidate_diff":
      return {
        result: {
          working_revision: state.run.working_revision,
          graph_digest: state.run.graph_digest,
          node_count: graph.nodes.length,
          edge_count: graph.edges.length,
        },
        checkpoint: state.checkpoint,
      };
    case "analyze_semantic_impact":
      return {
        result: {
          working_revision: state.run.working_revision,
          active_nodes: graph.nodes.filter((node) => node.lifecycle === "ACTIVE").length,
          active_edges: graph.edges.filter((edge) => edge.lifecycle === "ACTIVE").length,
          formula_dependencies: graph.edges.filter((edge) => edge.edge_type === "DEPENDS_ON")
            .length,
          physical_bindings: graph.edges.filter((edge) =>
            ["REPRESENTED_BY", "IDENTIFIED_BY", "BOUND_TO", "REFERENCES", "SUPPORTED_BY"].includes(
              edge.edge_type,
            ),
          ).length,
        },
        checkpoint: state.checkpoint,
      };
    default:
      throw new SemanticAuthoringToolError(
        "SEMANTIC_NOT_READ_TOOL",
        `${call.tool_name} 不是只读工具。`,
      );
  }
}

export async function executeSemanticAuthoringTool(
  state: SemanticAuthoringState,
  callInput: unknown,
  context: SemanticAuthoringToolExecutionContext,
): Promise<SemanticAuthoringToolExecution> {
  const call = semanticAuthoringToolCallSchema.parse(callInput);
  if (state.run.status !== "RUNNING") {
    throw new SemanticAuthoringToolError(
      "SEMANTIC_AUTHORING_NOT_RUNNING",
      `当前 authoring run 状态为 ${state.run.status}，不能执行工具。`,
    );
  }
  if (state.run.used_tool_calls >= state.run.budget.max_tool_calls) {
    throw new SemanticAuthoringToolError(
      "SEMANTIC_AUTHORING_TOOL_BUDGET_EXCEEDED",
      "Authoring tool-call budget 已耗尽。",
    );
  }

  const operation = mutationOperation(call);
  let nextGraph = state.working_graph;
  let checkpoint = state.checkpoint;
  let result: unknown;
  let patch: SemanticAuthoringToolReceipt["patch"] = null;
  let receiptStatus: SemanticAuthoringToolReceipt["status"] = "SUCCEEDED";
  let validation: SemanticAuthoringValidationReceipt | null = null;
  let requestsClarification = false;
  let requestsCompletion = false;

  if (operation !== null) {
    enforceMutationPolicy(state, call);
    const created = await createSemanticGraphPatch(state.working_graph, {
      patch_id: context.new_id(),
      candidate_id: state.run.candidate_id,
      from_working_revision: state.run.working_revision,
      operations: [operation],
      validate_result: false,
    });
    nextGraph = created.next_graph;
    patch = created.patch;
    result = { patch: created.patch };
    checkpoint = checkpointWith(checkpoint, { last_validation: null });
  } else if (call.tool_name === "validate_semantic_graph") {
    validation = await validationReceipt(state, context);
    result = { validation };
    checkpoint = checkpointWith(checkpoint, { last_validation: validation });
  } else if (call.tool_name === "request_semantic_clarification") {
    receiptStatus = "CLARIFICATION_REQUIRED";
    requestsClarification = true;
    result = {
      clarification_id: context.new_id(),
      question: call.arguments.question,
      options: call.arguments.options,
    };
  } else if (call.tool_name === "complete_authoring_run") {
    const latest = state.checkpoint.last_validation;
    if (
      latest === null ||
      !latest.valid ||
      latest.graph_digest !== state.run.graph_digest ||
      latest.receipt_digest !== call.arguments.validation_receipt_digest ||
      call.arguments.expected_graph_digest !== state.run.graph_digest
    ) {
      throw new SemanticAuthoringToolError(
        "SEMANTIC_AUTHORING_VALIDATION_RECEIPT_STALE",
        "完成创作必须提供绑定当前 Graph 摘要的 exact valid validation receipt。",
      );
    }
    receiptStatus = "COMPLETED";
    requestsCompletion = true;
    validation = latest;
    result = { summary: call.arguments.summary, validation_receipt: latest };
  } else {
    const read = await readResult(state, call);
    result = read.result;
    checkpoint = read.checkpoint;
  }

  const beforeDigest = state.run.graph_digest;
  const afterDigest = await computeSemanticGraphDigest(nextGraph);
  const inputDigest = await sha256ContentHash(call);
  const outputDigest = await sha256ContentHash(result);
  const receiptMaterial = {
    receipt_version: SEMANTIC_AUTHORING_TOOL_RECEIPT_VERSION,
    receipt_id: context.new_id(),
    authoring_run_id: state.run.authoring_run_id,
    candidate_id: state.run.candidate_id,
    turn_index: context.turn_index,
    tool_call_id: call.tool_call_id,
    tool_name: call.tool_name,
    idempotency_key: `${state.run.authoring_run_id}:${context.turn_index}:${call.tool_call_id}`,
    input_digest: inputDigest,
    output_digest: outputDigest,
    status: receiptStatus,
    mutation: patch !== null,
    from_working_revision: state.run.working_revision,
    to_working_revision: patch?.to_working_revision ?? state.run.working_revision,
    before_digest: beforeDigest,
    after_digest: afterDigest,
    patch,
    result,
    error_code: null,
    committed_at: context.now(),
  };
  const receipt = semanticAuthoringToolReceiptSchema.parse({
    ...receiptMaterial,
    receipt_digest: await sha256ContentHash(receiptMaterial),
  });

  const events: SemanticAuthoringPublicEvent[] = [
    stableEvent(state, context, 1, {
      type: "tool",
      payload: {
        call_id: call.tool_call_id,
        tool_name: call.tool_name,
        status: "COMPLETED",
        summary: requestsClarification
          ? "等待用户澄清"
          : requestsCompletion
            ? "Agent 已请求结束创作"
            : patch === null
              ? "只读或确定性分析完成"
              : "Candidate Graph patch 已提交",
        error_code: null,
      },
    }),
  ];
  if (patch !== null) {
    const affected = affectedSemanticGraphEntryIds(patch);
    events.push(
      stableEvent(state, context, events.length + 1, {
        type: "graph_patch",
        payload: {
          patch_id: patch.patch_id,
          from_working_revision: patch.from_working_revision,
          to_working_revision: patch.to_working_revision,
          before_digest: patch.before_digest,
          after_digest: patch.after_digest,
          operation_count: patch.operations.length,
          affected_node_ids: [...affected.node_ids],
          affected_edge_ids: [...affected.edge_ids],
        },
      }),
    );
  }
  if (validation !== null && call.tool_name === "validate_semantic_graph") {
    events.push(
      stableEvent(state, context, events.length + 1, {
        type: "validation",
        payload: validation,
      }),
    );
  }
  if (requestsClarification) {
    const clarification = result as {
      clarification_id: string;
      question: string;
      options: string[];
    };
    events.push(
      stableEvent(state, context, events.length + 1, {
        type: "clarification",
        payload: { ...clarification, status: "WAITING" },
      }),
    );
  }
  return {
    call,
    receipt,
    next_graph: nextGraph,
    checkpoint,
    events,
    validation_receipt: validation,
    requests_clarification: requestsClarification,
    requests_completion: requestsCompletion,
  };
}
