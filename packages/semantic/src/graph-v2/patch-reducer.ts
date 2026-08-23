import {
  SEMANTIC_GRAPH_PATCH_VERSION,
  type SemanticGraphEdge,
  type SemanticGraphNode,
  type SemanticGraphPatch,
  type SemanticGraphPatchOperation,
  type SemanticGraphSource,
  semanticGraphPatchOperationSchema,
  semanticGraphPatchSchema,
  semanticGraphSourceSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { z } from "zod";
import { canonicalizeSemanticGraph, computeSemanticGraphDigest } from "./canonicalize.js";
import { SemanticGraphError, SemanticGraphErrorCode } from "./errors.js";
import { validateSemanticGraph } from "./validator.js";

async function assertEntryDigest(
  entry: SemanticGraphNode | SemanticGraphEdge,
  expectedDigest: string,
): Promise<void> {
  if ((await sha256ContentHash(entry)) !== expectedDigest) {
    throw new SemanticGraphError(
      SemanticGraphErrorCode.PATCH_CONFLICT,
      "Graph patch entry digest 与当前 revision 不一致。",
    );
  }
}

function assertAgentManagedNode(graph: SemanticGraphSource, node: SemanticGraphNode): void {
  const definition = graph.node_type_registry.find((entry) => entry.node_type === node.node_type);
  if (definition?.authoring_policy !== "AGENT_AUTHORED") {
    throw new SemanticGraphError(
      SemanticGraphErrorCode.SYSTEM_MANAGED_MUTATION,
      `Agent 不得修改 system-managed Node ${node.node_id}。`,
    );
  }
}

function assertAgentManagedEdge(graph: SemanticGraphSource, edge: SemanticGraphEdge): void {
  const definition = graph.edge_type_registry.find((entry) => entry.edge_type === edge.edge_type);
  if (definition?.authoring_policy !== "AGENT_AUTHORED") {
    throw new SemanticGraphError(
      SemanticGraphErrorCode.SYSTEM_MANAGED_MUTATION,
      `Agent 不得修改 system-managed Edge ${edge.edge_id}。`,
    );
  }
}

async function reduceSemanticGraphOperations(
  current: SemanticGraphSource,
  operations: readonly SemanticGraphPatchOperation[],
  validateResult = true,
): Promise<SemanticGraphSource> {
  const agentManagedEdgeTypes = new Set(
    current.edge_type_registry
      .filter((definition) => definition.authoring_policy === "AGENT_AUTHORED")
      .map((definition) => definition.edge_type),
  );
  for (const operation of operations) {
    if (operation.operation === "ADD_NODE") assertAgentManagedNode(current, operation.node);
    if (operation.operation === "UPDATE_NODE") assertAgentManagedNode(current, operation.node);
    if (
      operation.operation === "ADD_EDGE" &&
      !agentManagedEdgeTypes.has(operation.edge.edge_type)
    ) {
      throw new SemanticGraphError(
        SemanticGraphErrorCode.SYSTEM_MANAGED_MUTATION,
        `Agent 不得修改 system-managed Edge ${operation.edge.edge_id}。`,
      );
    }
    if (operation.operation === "UPDATE_EDGE") assertAgentManagedEdge(current, operation.edge);
    if (
      operation.operation === "ADD_EDGE_TYPE" &&
      operation.edge_type_definition.authoring_policy !== "AGENT_AUTHORED"
    ) {
      throw new SemanticGraphError(
        SemanticGraphErrorCode.SYSTEM_MANAGED_MUTATION,
        `Agent 不得新增 system-managed Edge type ${operation.edge_type_definition.edge_type}。`,
      );
    }
    if (operation.operation === "ADD_EDGE_TYPE") {
      agentManagedEdgeTypes.add(operation.edge_type_definition.edge_type);
    }
    if (operation.operation === "RETIRE_NODE") {
      const node = current.nodes.find((entry) => entry.node_id === operation.node_id);
      if (node !== undefined) assertAgentManagedNode(current, node);
    }
    if (operation.operation === "RETIRE_EDGE") {
      const edge = current.edges.find((entry) => entry.edge_id === operation.edge_id);
      if (edge !== undefined) assertAgentManagedEdge(current, edge);
    }
  }

  const working = semanticGraphSourceSchema.parse(current);
  for (const operation of operations) {
    switch (operation.operation) {
      case "ADD_EDGE_TYPE": {
        if (
          working.edge_type_registry.some(
            (entry) => entry.edge_type === operation.edge_type_definition.edge_type,
          )
        ) {
          throw new SemanticGraphError(
            SemanticGraphErrorCode.PATCH_CONFLICT,
            `Edge type ${operation.edge_type_definition.edge_type} 已存在。`,
          );
        }
        working.edge_type_registry.push(operation.edge_type_definition);
        break;
      }
      case "ADD_NODE": {
        if (working.nodes.some((entry) => entry.node_id === operation.node.node_id)) {
          throw new SemanticGraphError(
            SemanticGraphErrorCode.PATCH_CONFLICT,
            `Node ${operation.node.node_id} 已存在。`,
          );
        }
        if (operation.node.node_version !== 1) {
          throw new SemanticGraphError(
            SemanticGraphErrorCode.PATCH_CONFLICT,
            "新 Node 的 node_version 必须为 1。",
          );
        }
        working.nodes.push(operation.node);
        break;
      }
      case "UPDATE_NODE": {
        const index = working.nodes.findIndex((entry) => entry.node_id === operation.node.node_id);
        const currentNode = working.nodes[index];
        if (currentNode === undefined) {
          throw new SemanticGraphError(
            SemanticGraphErrorCode.PATCH_CONFLICT,
            `Node ${operation.node.node_id} 不存在。`,
          );
        }
        await assertEntryDigest(currentNode, operation.expected_entry_digest);
        if (
          currentNode.node_version !== operation.expected_node_version ||
          operation.node.node_version !== currentNode.node_version + 1 ||
          operation.node.node_type !== currentNode.node_type
        ) {
          throw new SemanticGraphError(
            SemanticGraphErrorCode.PATCH_CONFLICT,
            `Node ${operation.node.node_id} version/type CAS 失败。`,
          );
        }
        working.nodes[index] = operation.node;
        break;
      }
      case "RETIRE_NODE": {
        const index = working.nodes.findIndex((entry) => entry.node_id === operation.node_id);
        const currentNode = working.nodes[index];
        if (currentNode === undefined) {
          throw new SemanticGraphError(
            SemanticGraphErrorCode.PATCH_CONFLICT,
            `Node ${operation.node_id} 不存在。`,
          );
        }
        await assertEntryDigest(currentNode, operation.expected_entry_digest);
        if (currentNode.node_version !== operation.expected_node_version) {
          throw new SemanticGraphError(
            SemanticGraphErrorCode.PATCH_CONFLICT,
            `Node ${operation.node_id} version CAS 失败。`,
          );
        }
        working.nodes[index] = {
          ...currentNode,
          node_version: currentNode.node_version + 1,
          lifecycle: "RETIRED",
        };
        break;
      }
      case "ADD_EDGE": {
        if (working.edges.some((entry) => entry.edge_id === operation.edge.edge_id)) {
          throw new SemanticGraphError(
            SemanticGraphErrorCode.PATCH_CONFLICT,
            `Edge ${operation.edge.edge_id} 已存在。`,
          );
        }
        if (operation.edge.edge_version !== 1) {
          throw new SemanticGraphError(
            SemanticGraphErrorCode.PATCH_CONFLICT,
            "新 Edge 的 edge_version 必须为 1。",
          );
        }
        working.edges.push(operation.edge);
        break;
      }
      case "UPDATE_EDGE": {
        const index = working.edges.findIndex((entry) => entry.edge_id === operation.edge.edge_id);
        const currentEdge = working.edges[index];
        if (currentEdge === undefined) {
          throw new SemanticGraphError(
            SemanticGraphErrorCode.PATCH_CONFLICT,
            `Edge ${operation.edge.edge_id} 不存在。`,
          );
        }
        await assertEntryDigest(currentEdge, operation.expected_entry_digest);
        if (
          currentEdge.edge_version !== operation.expected_edge_version ||
          operation.edge.edge_version !== currentEdge.edge_version + 1 ||
          operation.edge.edge_type !== currentEdge.edge_type ||
          operation.edge.source_node_id !== currentEdge.source_node_id ||
          operation.edge.target_node_id !== currentEdge.target_node_id
        ) {
          throw new SemanticGraphError(
            SemanticGraphErrorCode.PATCH_CONFLICT,
            `Edge ${operation.edge.edge_id} version/endpoints/type CAS 失败；rebind 必须 retire + add。`,
          );
        }
        working.edges[index] = operation.edge;
        break;
      }
      case "RETIRE_EDGE": {
        const index = working.edges.findIndex((entry) => entry.edge_id === operation.edge_id);
        const currentEdge = working.edges[index];
        if (currentEdge === undefined) {
          throw new SemanticGraphError(
            SemanticGraphErrorCode.PATCH_CONFLICT,
            `Edge ${operation.edge_id} 不存在。`,
          );
        }
        await assertEntryDigest(currentEdge, operation.expected_entry_digest);
        if (currentEdge.edge_version !== operation.expected_edge_version) {
          throw new SemanticGraphError(
            SemanticGraphErrorCode.PATCH_CONFLICT,
            `Edge ${operation.edge_id} version CAS 失败。`,
          );
        }
        working.edges[index] = {
          ...currentEdge,
          edge_version: currentEdge.edge_version + 1,
          lifecycle: "RETIRED",
        };
        break;
      }
    }
  }
  const validationIssues = validateResult ? validateSemanticGraph(working) : [];
  if (validationIssues.length > 0) {
    const first = validationIssues.at(0);
    if (first === undefined) {
      throw new SemanticGraphError(
        SemanticGraphErrorCode.RUNTIME_COMPATIBILITY_AMBIGUOUS,
        "语义图校验失败。",
      );
    }
    throw new SemanticGraphError(first.code, first.message, first.details);
  }
  const canonical = canonicalizeSemanticGraph(working);
  return canonical;
}

export async function createSemanticGraphPatch(
  currentInput: unknown,
  input: {
    readonly patch_id: string;
    readonly candidate_id: string;
    readonly from_working_revision: number;
    readonly operations: readonly SemanticGraphPatchOperation[];
    readonly validate_result?: boolean;
  },
): Promise<{ readonly patch: SemanticGraphPatch; readonly next_graph: SemanticGraphSource }> {
  const current = semanticGraphSourceSchema.parse(currentInput);
  const operations = z.array(semanticGraphPatchOperationSchema).min(1).parse(input.operations);
  const beforeDigest = await computeSemanticGraphDigest(current);
  const nextGraph = await reduceSemanticGraphOperations(
    current,
    operations,
    input.validate_result ?? true,
  );
  const patchMaterial = {
    patch_version: SEMANTIC_GRAPH_PATCH_VERSION,
    patch_id: input.patch_id,
    graph_id: current.metadata.graph_id,
    candidate_id: input.candidate_id,
    from_working_revision: input.from_working_revision,
    to_working_revision: input.from_working_revision + 1,
    before_digest: beforeDigest,
    after_digest: await computeSemanticGraphDigest(nextGraph),
    operations,
  };
  const patch = semanticGraphPatchSchema.parse({
    ...patchMaterial,
    patch_digest: await sha256ContentHash(patchMaterial),
  });
  return { patch, next_graph: nextGraph };
}

export async function applySemanticGraphPatch(
  currentInput: unknown,
  patchInput: unknown,
): Promise<SemanticGraphSource> {
  const current = semanticGraphSourceSchema.parse(currentInput);
  const patch = semanticGraphPatchSchema.parse(patchInput);
  if (patch.graph_id !== current.metadata.graph_id) {
    throw new SemanticGraphError(
      SemanticGraphErrorCode.PATCH_CONFLICT,
      "Graph patch graph_id 与当前 Graph 不一致。",
    );
  }
  if (patch.to_working_revision !== patch.from_working_revision + 1) {
    throw new SemanticGraphError(
      SemanticGraphErrorCode.PATCH_CONFLICT,
      "Graph patch working revision 必须连续递增。",
    );
  }
  if ((await computeSemanticGraphDigest(current)) !== patch.before_digest) {
    throw new SemanticGraphError(
      SemanticGraphErrorCode.PATCH_CONFLICT,
      "Graph patch before_digest 与当前 Graph 不一致。",
    );
  }

  const canonical = await reduceSemanticGraphOperations(current, patch.operations);
  if ((await computeSemanticGraphDigest(canonical)) !== patch.after_digest) {
    throw new SemanticGraphError(
      SemanticGraphErrorCode.PATCH_DIGEST_MISMATCH,
      "Graph patch after_digest 与 reducer 结果不一致。",
    );
  }
  const { patch_digest: _patchDigest, ...patchMaterial } = patch;
  if ((await sha256ContentHash(patchMaterial)) !== patch.patch_digest) {
    throw new SemanticGraphError(
      SemanticGraphErrorCode.PATCH_DIGEST_MISMATCH,
      "Graph patch 自身 digest 不一致。",
    );
  }
  return canonical;
}
