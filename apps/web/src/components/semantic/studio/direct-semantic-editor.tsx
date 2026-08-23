"use client";

import {
  type SemanticEdgeTypeDefinition,
  type SemanticFormulaExpression,
  type SemanticGraphEdge,
  type SemanticGraphNode,
  type SemanticGraphReadEdge,
  type SemanticGraphReadNode,
  type SemanticManualEdit,
  type SemanticNodeType,
  semanticEdgeTypeDefinitionSchema,
  semanticGraphEdgeSchema,
  semanticGraphNodeSchema,
} from "@data-agent/contracts";
import { ArrowRight, FloppyDisk, Link, Plus, Trash, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";

export type DirectEditorMode = "EDIT_SELECTION" | "ADD_NODE" | "ADD_EDGE" | "PROPOSE_EDGE_TYPE";

const AUTHORABLE_NODE_TYPES: readonly SemanticNodeType[] = [
  "BUSINESS_SUBJECT",
  "DIMENSION",
  "METRIC",
  "FORMULA",
  "GLOSSARY_TERM",
];

function defaultAttributes(kind: SemanticEdgeTypeDefinition["attribute_kind"], edgeType: string) {
  switch (kind) {
    case "NONE":
      return { kind: "NONE" } as const;
    case "BUSINESS_RELATION":
      return { kind, relationship_name: edgeType, cardinality: "many-to-one" } as const;
    case "SLOT_BINDING":
      return { kind, slot_id: "value", role: "DEPENDENCY" } as const;
    case "BINDING":
      return { kind, role: "PRIMARY" } as const;
    case "GRAIN_BINDING":
      return {
        kind,
        grain: { grain_id: "atomic", granularity: "atomic" },
        time_domain: null,
      } as const;
    case "JOIN_PROOF":
      return {
        kind,
        cardinality: "many-to-one",
        left_row_preservation: "optional",
        right_row_preservation: "optional",
        proof_kind: "DECLARED_ONLY",
        proof_detail: null,
        analysis: { join_allowed: false, fanout_closed: false, ontology_path: [] as string[] },
      } as const;
    case "PROVENANCE":
      return { kind, derivation_kind: "DERIVED", note: null } as const;
    case "DIMENSION_USE":
      return { kind, role: "GROUP_BY" } as const;
    case "TERM_LINK":
      return { kind, lexical_role: "RELATED" } as const;
    case "PHYSICAL_FACT":
      throw new TypeError("SYSTEM_MANAGED_EDGE_TYPE");
  }
}

function baseNode(type: SemanticNodeType, id: string, name: string, owner: string) {
  const common = {
    node_id: id,
    node_version: 1,
    name,
    description: "",
    aliases: [],
    owner_ref: owner,
    lifecycle: "ACTIVE",
    evidence_refs: [],
    tags: [],
  } as const;
  switch (type) {
    case "BUSINESS_SUBJECT":
      return { ...common, node_type: type, domain: "business" };
    case "DIMENSION":
      return {
        ...common,
        node_type: type,
        data_type: "text",
        sensitivity: "PUBLIC",
        filter_semantics: "EXACT",
        analysis: { groupable: true, pivotable: true, causal_role: null },
      };
    case "METRIC":
      return {
        ...common,
        node_type: type,
        unit: null,
        additivity: "non-additive",
        null_policy: "preserve",
        fanout_policy: "reject",
        analysis: {
          primary: false,
          priority: 100,
          missing_period_policy: "NULL",
          seasonality: null,
          allowed_dimension_ids: [],
          capabilities: [],
          causal_role: null,
        },
      };
    case "FORMULA":
      return {
        ...common,
        node_type: type,
        formula_type: "other",
        return_type: "numeric",
        language: "semantic-ast",
        language_version: "semantic-formula-ast@1",
        expression: { kind: "LITERAL", value: 0 },
      };
    case "GLOSSARY_TERM":
      return {
        ...common,
        node_type: type,
        definition: name,
        language: "zh-CN",
        term_kind: "BUSINESS",
        abbreviation: null,
      };
    case "PHYSICAL_TABLE":
    case "PHYSICAL_COLUMN":
      throw new TypeError("SYSTEM_MANAGED_NODE_TYPE");
  }
}

const fieldClass =
  "h-9 w-full border border-[var(--color-border-default)] bg-white px-3 text-[11px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]";

type EdgeAttributes = SemanticGraphEdge["attributes"];

function defaultFormulaExpression(
  kind: SemanticFormulaExpression["kind"],
): SemanticFormulaExpression {
  switch (kind) {
    case "LITERAL":
      return { kind, value: 0 };
    case "SLOT":
      return { kind, slot_id: "value" };
    case "BINARY":
      return {
        kind,
        operator: "ADD",
        left: { kind: "SLOT", slot_id: "value" },
        right: { kind: "LITERAL", value: 0 },
      };
    case "BOOLEAN":
      return {
        kind,
        operator: "AND",
        operands: [
          { kind: "LITERAL", value: true },
          { kind: "LITERAL", value: true },
        ],
      };
    case "NOT":
      return { kind, operand: { kind: "LITERAL", value: true } };
    case "CASE":
      return {
        kind,
        branches: [
          {
            when: { kind: "LITERAL", value: true },
            result: { kind: "LITERAL", value: 0 },
          },
        ],
        otherwise: null,
      };
    case "AGGREGATE":
      return {
        kind,
        function: "SUM",
        input: { kind: "SLOT", slot_id: "value" },
        distinct: false,
        filter: null,
      };
    case "DATE_BUCKET":
      return {
        kind,
        granularity: "day",
        input: { kind: "SLOT", slot_id: "value" },
      };
  }
}

function EnumSelect<const T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly T[];
  readonly onChange: (value: T) => void;
}) {
  return (
    <label className="text-[10px] text-[var(--color-text-secondary)]">
      {label}
      <select
        className={`${fieldClass} mt-1`}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function FormulaExpressionEditor({
  value,
  onChange,
  depth = 0,
  path = "root",
}: {
  readonly value: SemanticFormulaExpression;
  readonly onChange: (value: SemanticFormulaExpression) => void;
  readonly depth?: number;
  readonly path?: string;
}) {
  const nestedClass = depth === 0 ? "" : "border-l border-[var(--color-border-default)] pl-3";
  return (
    <div className={`grid gap-2 ${nestedClass}`}>
      <EnumSelect
        label="表达式类型"
        value={value.kind}
        options={[
          "LITERAL",
          "SLOT",
          "BINARY",
          "BOOLEAN",
          "NOT",
          "CASE",
          "AGGREGATE",
          "DATE_BUCKET",
        ]}
        onChange={(kind) => onChange(defaultFormulaExpression(kind))}
      />
      {value.kind === "LITERAL" ? (
        <label className="text-[10px] text-[var(--color-text-secondary)]">
          常量
          <input
            className={`${fieldClass} mt-1 font-mono`}
            value={value.value === null ? "null" : String(value.value)}
            onChange={(event) => {
              const raw = event.target.value;
              const parsed =
                raw === "null"
                  ? null
                  : raw === "true"
                    ? true
                    : raw === "false"
                      ? false
                      : raw.trim() !== "" && Number.isFinite(Number(raw))
                        ? Number(raw)
                        : raw;
              onChange({ kind: "LITERAL", value: parsed });
            }}
          />
        </label>
      ) : null}
      {value.kind === "SLOT" ? (
        <label className="text-[10px] text-[var(--color-text-secondary)]">
          Slot ID
          <input
            className={`${fieldClass} mt-1 font-mono`}
            value={value.slot_id}
            onChange={(event) => onChange({ ...value, slot_id: event.target.value })}
          />
        </label>
      ) : null}
      {value.kind === "BINARY" ? (
        <>
          <EnumSelect
            label="运算符"
            value={value.operator}
            options={[
              "ADD",
              "SUBTRACT",
              "MULTIPLY",
              "DIVIDE",
              "EQ",
              "NEQ",
              "GT",
              "GTE",
              "LT",
              "LTE",
            ]}
            onChange={(operator) => onChange({ ...value, operator })}
          />
          <FormulaExpressionEditor
            value={value.left}
            depth={depth + 1}
            path={`${path}.left`}
            onChange={(left) => onChange({ ...value, left })}
          />
          <FormulaExpressionEditor
            value={value.right}
            depth={depth + 1}
            path={`${path}.right`}
            onChange={(right) => onChange({ ...value, right })}
          />
        </>
      ) : null}
      {value.kind === "BOOLEAN" ? (
        <>
          <EnumSelect
            label="布尔运算"
            value={value.operator}
            options={["AND", "OR"]}
            onChange={(operator) => onChange({ ...value, operator })}
          />
          {value.operands.map((operand, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: formula AST operands have no persisted identity and remain fully controlled.
            <div key={`${path}.operands.${index}`} className="grid gap-2">
              <FormulaExpressionEditor
                value={operand}
                depth={depth + 1}
                path={`${path}.operands.${index}`}
                onChange={(next) =>
                  onChange({
                    ...value,
                    operands: value.operands.map((item, itemIndex) =>
                      itemIndex === index ? next : item,
                    ),
                  })
                }
              />
              {value.operands.length > 2 ? (
                <button
                  type="button"
                  className="justify-self-start text-[10px] text-red-700"
                  onClick={() =>
                    onChange({
                      ...value,
                      operands: value.operands.filter((_, itemIndex) => itemIndex !== index),
                    })
                  }
                >
                  移除此条件
                </button>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            className="justify-self-start text-[10px] font-semibold text-[var(--color-accent)]"
            onClick={() =>
              onChange({
                ...value,
                operands: [...value.operands, { kind: "LITERAL", value: true }],
              })
            }
          >
            + 添加条件
          </button>
        </>
      ) : null}
      {value.kind === "NOT" ? (
        <FormulaExpressionEditor
          value={value.operand}
          depth={depth + 1}
          path={`${path}.operand`}
          onChange={(operand) => onChange({ ...value, operand })}
        />
      ) : null}
      {value.kind === "DATE_BUCKET" ? (
        <>
          <EnumSelect
            label="时间粒度"
            value={value.granularity}
            options={["hour", "day", "week", "month", "quarter", "year"]}
            onChange={(granularity) => onChange({ ...value, granularity })}
          />
          <FormulaExpressionEditor
            value={value.input}
            depth={depth + 1}
            path={`${path}.input`}
            onChange={(input) => onChange({ ...value, input })}
          />
        </>
      ) : null}
      {value.kind === "AGGREGATE" ? (
        <>
          <EnumSelect
            label="聚合函数"
            value={value.function}
            options={["SUM", "COUNT", "COUNT_DISTINCT", "AVG", "MIN", "MAX"]}
            onChange={(aggregateFunction) => onChange({ ...value, function: aggregateFunction })}
          />
          <label className="flex items-center gap-2 text-[10px] text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={value.distinct}
              onChange={(event) => onChange({ ...value, distinct: event.target.checked })}
            />
            去重聚合
          </label>
          {value.input ? (
            <FormulaExpressionEditor
              value={value.input}
              depth={depth + 1}
              path={`${path}.input`}
              onChange={(input) => onChange({ ...value, input })}
            />
          ) : (
            <button
              type="button"
              className="justify-self-start text-[10px] text-[var(--color-accent)]"
              onClick={() => onChange({ ...value, input: { kind: "SLOT", slot_id: "value" } })}
            >
              + 添加聚合输入
            </button>
          )}
          {value.filter ? (
            <FormulaExpressionEditor
              value={value.filter}
              depth={depth + 1}
              path={`${path}.filter`}
              onChange={(filter) => onChange({ ...value, filter })}
            />
          ) : (
            <button
              type="button"
              className="justify-self-start text-[10px] text-[var(--color-accent)]"
              onClick={() => onChange({ ...value, filter: { kind: "LITERAL", value: true } })}
            >
              + 添加过滤条件
            </button>
          )}
        </>
      ) : null}
      {value.kind === "CASE" ? (
        <>
          {value.branches.map((branch, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: formula AST branches have no persisted identity and remain fully controlled.
              key={`${path}.branches.${index}`}
              className="grid gap-2 border-l border-[var(--color-border-overlay)] pl-3"
            >
              <span className="text-[10px] font-semibold text-[var(--color-accent)]">
                分支 {index + 1}
              </span>
              <FormulaExpressionEditor
                value={branch.when}
                depth={depth + 1}
                path={`${path}.branches.${index}.when`}
                onChange={(when) =>
                  onChange({
                    ...value,
                    branches: value.branches.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, when } : item,
                    ),
                  })
                }
              />
              <FormulaExpressionEditor
                value={branch.result}
                depth={depth + 1}
                path={`${path}.branches.${index}.result`}
                onChange={(result) =>
                  onChange({
                    ...value,
                    branches: value.branches.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, result } : item,
                    ),
                  })
                }
              />
            </div>
          ))}
          <button
            type="button"
            className="justify-self-start text-[10px] font-semibold text-[var(--color-accent)]"
            onClick={() =>
              onChange({
                ...value,
                branches: [
                  ...value.branches,
                  {
                    when: { kind: "LITERAL", value: true },
                    result: { kind: "LITERAL", value: 0 },
                  },
                ],
              })
            }
          >
            + 添加分支
          </button>
          {value.otherwise ? (
            <FormulaExpressionEditor
              value={value.otherwise}
              depth={depth + 1}
              path={`${path}.otherwise`}
              onChange={(otherwise) => onChange({ ...value, otherwise })}
            />
          ) : (
            <button
              type="button"
              className="justify-self-start text-[10px] text-[var(--color-accent)]"
              onClick={() => onChange({ ...value, otherwise: { kind: "LITERAL", value: 0 } })}
            >
              + 添加 ELSE
            </button>
          )}
        </>
      ) : null}
    </div>
  );
}

function EdgeAttributesEditor({
  value,
  onChange,
}: {
  readonly value: EdgeAttributes;
  readonly onChange: (value: EdgeAttributes) => void;
}) {
  if (value.kind === "NONE") {
    return <p className="text-[10px] text-[var(--color-text-muted)]">此关系类型没有可编辑属性。</p>;
  }
  if (value.kind === "BUSINESS_RELATION") {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-[10px] text-[var(--color-text-secondary)]">
          关系名称
          <input
            className={`${fieldClass} mt-1`}
            value={value.relationship_name}
            onChange={(event) => onChange({ ...value, relationship_name: event.target.value })}
          />
        </label>
        <EnumSelect
          label="基数"
          value={value.cardinality}
          options={["one-to-one", "one-to-many", "many-to-one", "many-to-many"]}
          onChange={(cardinality) => onChange({ ...value, cardinality })}
        />
      </div>
    );
  }
  if (value.kind === "SLOT_BINDING") {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-[10px] text-[var(--color-text-secondary)]">
          Slot ID
          <input
            className={`${fieldClass} mt-1 font-mono`}
            value={value.slot_id}
            onChange={(event) => onChange({ ...value, slot_id: event.target.value })}
          />
        </label>
        <EnumSelect
          label="角色"
          value={value.role}
          options={["MEASURE", "FILTER", "TIME", "DEPENDENCY"]}
          onChange={(role) => onChange({ ...value, role })}
        />
      </div>
    );
  }
  if (value.kind === "BINDING") {
    return (
      <EnumSelect
        label="绑定角色"
        value={value.role}
        options={["PRIMARY", "ALTERNATE"]}
        onChange={(role) => onChange({ ...value, role })}
      />
    );
  }
  if (value.kind === "GRAIN_BINDING") {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-[10px] text-[var(--color-text-secondary)]">
          粒度 ID
          <input
            className={`${fieldClass} mt-1 font-mono`}
            value={value.grain.grain_id}
            onChange={(event) =>
              onChange({ ...value, grain: { ...value.grain, grain_id: event.target.value } })
            }
          />
        </label>
        <EnumSelect
          label="粒度"
          value={value.grain.granularity}
          options={["atomic", "hour", "day", "week", "month", "quarter", "year"]}
          onChange={(granularity) => onChange({ ...value, grain: { ...value.grain, granularity } })}
        />
      </div>
    );
  }
  if (value.kind === "JOIN_PROOF") {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <EnumSelect
          label="基数"
          value={value.cardinality}
          options={["one-to-one", "one-to-many", "many-to-one", "many-to-many"]}
          onChange={(cardinality) => onChange({ ...value, cardinality })}
        />
        <EnumSelect
          label="左侧行保留"
          value={value.left_row_preservation}
          options={["required", "optional"]}
          onChange={(left_row_preservation) => onChange({ ...value, left_row_preservation })}
        />
        <EnumSelect
          label="右侧行保留"
          value={value.right_row_preservation}
          options={["required", "optional"]}
          onChange={(right_row_preservation) => onChange({ ...value, right_row_preservation })}
        />
        <EnumSelect
          label="证明类型"
          value={value.proof_kind}
          options={["DDL_ENFORCED", "SNAPSHOT_CERTIFIED", "DECLARED_ONLY"]}
          onChange={(proof_kind) => onChange({ ...value, proof_kind })}
        />
        <label className="text-[10px] text-[var(--color-text-secondary)] sm:col-span-2">
          证明说明
          <textarea
            className="mt-1 min-h-16 w-full border border-[var(--color-border-default)] p-3 text-xs"
            value={value.proof_detail ?? ""}
            onChange={(event) => onChange({ ...value, proof_detail: event.target.value || null })}
          />
        </label>
      </div>
    );
  }
  if (value.kind === "PROVENANCE") {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <EnumSelect
          label="派生类型"
          value={value.derivation_kind}
          options={["DERIVED", "SUPPORTED", "MIGRATED"]}
          onChange={(derivation_kind) => onChange({ ...value, derivation_kind })}
        />
        <label className="text-[10px] text-[var(--color-text-secondary)]">
          说明
          <input
            className={`${fieldClass} mt-1`}
            value={value.note ?? ""}
            onChange={(event) => onChange({ ...value, note: event.target.value || null })}
          />
        </label>
      </div>
    );
  }
  if (value.kind === "DIMENSION_USE") {
    return (
      <EnumSelect
        label="维度用途"
        value={value.role}
        options={["GROUP_BY", "FILTER", "TIME_CONTEXT"]}
        onChange={(role) => onChange({ ...value, role })}
      />
    );
  }
  if (value.kind === "TERM_LINK") {
    return (
      <EnumSelect
        label="术语关系"
        value={value.lexical_role}
        options={["PREFERRED", "SYNONYM", "ABBREVIATION", "RELATED"]}
        onChange={(lexical_role) => onChange({ ...value, lexical_role })}
      />
    );
  }
  return <p className="text-[10px] text-red-700">物理事实属性由 Schema 扫描维护，不可编辑。</p>;
}

export function DirectSemanticEditor({
  mode,
  selectedNode,
  selectedEdge,
  nodes,
  edgeTypes,
  ownerRef,
  onApply,
  onClose,
}: {
  readonly mode: DirectEditorMode;
  readonly selectedNode: SemanticGraphReadNode | null;
  readonly selectedEdge: SemanticGraphReadEdge | null;
  readonly nodes: readonly SemanticGraphNode[];
  readonly edgeTypes: readonly SemanticEdgeTypeDefinition[];
  readonly ownerRef: string;
  readonly onApply: (edit: SemanticManualEdit) => void;
  readonly onClose: () => void;
}) {
  const editableEdgeTypes = useMemo(
    () => edgeTypes.filter((type) => type.authoring_policy === "AGENT_AUTHORED"),
    [edgeTypes],
  );
  const [nodeType, setNodeType] = useState<SemanticNodeType>("METRIC");
  const [nodeId, setNodeId] = useState(`manual-${crypto.randomUUID()}`);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [lifecycle, setLifecycle] = useState<"ACTIVE" | "DEPRECATED" | "RETIRED">("ACTIVE");
  const [edgeType, setEdgeType] = useState(editableEdgeTypes[0]?.edge_type ?? "");
  const [edgeId, setEdgeId] = useState(`manual-edge-${crypto.randomUUID()}`);
  const [sourceId, setSourceId] = useState(nodes[0]?.node_id ?? "");
  const [targetId, setTargetId] = useState(nodes[1]?.node_id ?? nodes[0]?.node_id ?? "");
  const [formulaExpression, setFormulaExpression] = useState<SemanticFormulaExpression>({
    kind: "LITERAL",
    value: 0,
  });
  const [edgeAttributes, setEdgeAttributes] = useState<EdgeAttributes>(
    editableEdgeTypes[0]
      ? defaultAttributes(editableEdgeTypes[0].attribute_kind, editableEdgeTypes[0].edge_type)
      : { kind: "NONE" },
  );
  const [proposedEdgeType, setProposedEdgeType] = useState("CUSTOM_RELATION");
  const [proposedDisplayName, setProposedDisplayName] = useState("自定义业务关系");
  const [proposedFamily, setProposedFamily] =
    useState<SemanticEdgeTypeDefinition["family"]>("BUSINESS");
  const [proposedSources, setProposedSources] = useState<readonly SemanticNodeType[]>([
    "BUSINESS_SUBJECT",
  ]);
  const [proposedTargets, setProposedTargets] = useState<readonly SemanticNodeType[]>([
    "BUSINESS_SUBJECT",
  ]);
  const [proposedAttributeKind, setProposedAttributeKind] =
    useState<SemanticEdgeTypeDefinition["attribute_kind"]>("BUSINESS_RELATION");
  const [proposedParallelPolicy, setProposedParallelPolicy] = useState<
    SemanticEdgeTypeDefinition["parallel_policy"]
  >("ALLOW_DISTINCT_ATTRIBUTES");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "EDIT_SELECTION") return;
    if (selectedNode) {
      setNodeType(selectedNode.node.node_type);
      setNodeId(selectedNode.node.node_id);
      setName(selectedNode.node.name);
      setDescription(selectedNode.node.description ?? "");
      setLifecycle(selectedNode.node.lifecycle);
      if (selectedNode.node.node_type === "FORMULA") {
        setFormulaExpression(selectedNode.node.expression);
      }
    } else if (selectedEdge) {
      setEdgeType(selectedEdge.edge.edge_type);
      setEdgeId(selectedEdge.edge.edge_id);
      setSourceId(selectedEdge.edge.source_node_id);
      setTargetId(selectedEdge.edge.target_node_id);
      setLifecycle(selectedEdge.edge.lifecycle);
      setEdgeAttributes(selectedEdge.edge.attributes);
    }
  }, [mode, selectedEdge, selectedNode]);

  const selectedDefinition = editableEdgeTypes.find((item) => item.edge_type === edgeType);
  const sourceNodes = selectedDefinition
    ? nodes.filter((node) => selectedDefinition.source_node_types.includes(node.node_type))
    : [];
  const targetNodes = selectedDefinition
    ? nodes.filter((node) => selectedDefinition.target_node_types.includes(node.node_type))
    : [];
  const editingSystemManaged =
    selectedNode?.node.node_type === "PHYSICAL_TABLE" ||
    selectedNode?.node.node_type === "PHYSICAL_COLUMN" ||
    selectedEdge?.edge.edge_type === "CONTAINS_COLUMN" ||
    selectedEdge?.edge.edge_type === "FOREIGN_KEY_TO";

  useEffect(() => {
    if (mode !== "ADD_EDGE" || !selectedDefinition) return;
    setEdgeAttributes(
      defaultAttributes(selectedDefinition.attribute_kind, selectedDefinition.edge_type),
    );
    setSourceId((current) =>
      nodes.some(
        (node) =>
          node.node_id === current && selectedDefinition.source_node_types.includes(node.node_type),
      )
        ? current
        : (nodes.find((node) => selectedDefinition.source_node_types.includes(node.node_type))
            ?.node_id ?? ""),
    );
    setTargetId((current) =>
      nodes.some(
        (node) =>
          node.node_id === current && selectedDefinition.target_node_types.includes(node.node_type),
      )
        ? current
        : (nodes.find((node) => selectedDefinition.target_node_types.includes(node.node_type))
            ?.node_id ?? ""),
    );
  }, [mode, nodes, selectedDefinition]);

  function applyNode() {
    try {
      const draft =
        mode === "ADD_NODE"
          ? { ...baseNode(nodeType, nodeId.trim(), name.trim(), ownerRef), description }
          : {
              ...selectedNode?.node,
              node_version: (selectedNode?.node.node_version ?? 0) + 1,
              name: name.trim(),
              description,
              lifecycle,
            };
      const node = semanticGraphNodeSchema.parse(
        nodeType === "FORMULA" ? { ...draft, expression: formulaExpression } : draft,
      );
      onApply(
        mode === "ADD_NODE"
          ? { operation: "ADD_NODE", node }
          : {
              operation: "UPDATE_NODE",
              node,
              expected_node_version: selectedNode?.node.node_version ?? 0,
            },
      );
      onClose();
    } catch {
      setError("字段不符合该 Node 类型合同，请检查稳定 ID、名称和必填值。");
    }
  }

  function applyEdge() {
    try {
      const definition = selectedDefinition;
      if (!definition) throw new TypeError("EDGE_TYPE_REQUIRED");
      const edge = semanticGraphEdgeSchema.parse(
        mode === "ADD_EDGE"
          ? {
              edge_id: edgeId.trim(),
              edge_version: 1,
              edge_type: definition.edge_type,
              family: definition.family,
              source_node_id: sourceId,
              target_node_id: targetId,
              lifecycle: "ACTIVE",
              attributes: edgeAttributes,
              evidence_refs: [],
            }
          : {
              ...selectedEdge?.edge,
              edge_version: (selectedEdge?.edge.edge_version ?? 0) + 1,
              source_node_id: sourceId,
              target_node_id: targetId,
              lifecycle,
              attributes: edgeAttributes,
            },
      );
      onApply(
        mode === "ADD_EDGE"
          ? { operation: "ADD_EDGE", edge }
          : {
              operation: "UPDATE_EDGE",
              edge,
              expected_edge_version: selectedEdge?.edge.edge_version ?? 0,
            },
      );
      onClose();
    } catch {
      setError("端点或属性不符合已注册 Edge 类型合同。不能在这里创建新关系类型。");
    }
  }

  function applyEdgeTypeProposal() {
    try {
      const edgeTypeDefinition = semanticEdgeTypeDefinitionSchema.parse({
        edge_type: proposedEdgeType.trim(),
        display_name: proposedDisplayName.trim(),
        family: proposedFamily,
        source_node_types: proposedSources,
        target_node_types: proposedTargets,
        direction: "DIRECTED",
        parallel_policy: proposedParallelPolicy,
        authoring_policy: "AGENT_AUTHORED",
        attribute_kind: proposedAttributeKind,
      });
      onApply({ operation: "ADD_EDGE_TYPE", edge_type_definition: edgeTypeDefinition });
      onClose();
    } catch {
      setError("关系类型提案不符合注册合同；请检查稳定 ID、显示名称和允许端点。");
    }
  }

  function retire() {
    if (selectedNode) {
      onApply({
        operation: "RETIRE_NODE",
        node_id: selectedNode.node.node_id,
        expected_node_version: selectedNode.node.node_version,
        retirement_reason: "用户在直接编辑器中退役",
      });
    } else if (selectedEdge) {
      onApply({
        operation: "RETIRE_EDGE",
        edge_id: selectedEdge.edge.edge_id,
        expected_edge_version: selectedEdge.edge.edge_version,
        retirement_reason: "用户在直接编辑器中断开关系",
      });
    }
    onClose();
  }

  const nodeMode = mode === "ADD_NODE" || (mode === "EDIT_SELECTION" && selectedNode !== null);
  const proposalMode = mode === "PROPOSE_EDGE_TYPE";
  return (
    <section className="mt-4 border border-[var(--color-border-overlay)] bg-white shadow-[0_16px_38px_rgba(37,57,48,0.08)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
            Direct ChangeSet editor
          </p>
          <h2 className="mt-1 text-sm font-semibold text-[#27332e]">
            {mode === "ADD_NODE"
              ? "新建 Node"
              : mode === "ADD_EDGE"
                ? "新建 Edge"
                : mode === "PROPOSE_EDGE_TYPE"
                  ? "关系类型提案"
                  : "编辑选中对象"}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="control-pressable grid size-8 place-items-center rounded-[var(--radius-control)] hover:bg-[var(--color-bg-overlay)]"
          aria-label="关闭直接编辑器"
        >
          <X className="size-4" />
        </button>
      </div>
      {editingSystemManaged ? (
        <div className="border-l-2 border-amber-500 bg-amber-50 px-4 py-4 text-xs leading-5 text-amber-900">
          这是数据库扫描维护的物理事实，只读。请重新扫描 Schema，或创建不篡改原始事实的
          Agent-authored 覆盖关系。
        </div>
      ) : (
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
          {proposalMode ? (
            <>
              <label className="text-[10px] text-[var(--color-text-secondary)]">
                稳定类型 ID
                <input
                  className={`${fieldClass} mt-1 font-mono`}
                  value={proposedEdgeType}
                  onChange={(event) => setProposedEdgeType(event.target.value.toUpperCase())}
                />
              </label>
              <label className="text-[10px] text-[var(--color-text-secondary)]">
                显示名称
                <input
                  className={`${fieldClass} mt-1`}
                  value={proposedDisplayName}
                  onChange={(event) => setProposedDisplayName(event.target.value)}
                />
              </label>
              <EnumSelect
                label="关系族"
                value={proposedFamily}
                options={["BUSINESS", "ANALYTICAL", "FORMULA", "JOIN", "PROVENANCE", "TERMINOLOGY"]}
                onChange={setProposedFamily}
              />
              <EnumSelect
                label="属性合同"
                value={proposedAttributeKind}
                options={[
                  "NONE",
                  "BUSINESS_RELATION",
                  "SLOT_BINDING",
                  "BINDING",
                  "GRAIN_BINDING",
                  "JOIN_PROOF",
                  "PROVENANCE",
                  "DIMENSION_USE",
                  "TERM_LINK",
                ]}
                onChange={setProposedAttributeKind}
              />
              <EnumSelect
                label="并行关系策略"
                value={proposedParallelPolicy}
                options={["FORBID", "ALLOW_DISTINCT_ATTRIBUTES"]}
                onChange={setProposedParallelPolicy}
              />
              <fieldset className="border border-[var(--color-border-default)] p-3 md:col-span-2">
                <legend className="px-1 text-[10px] text-[var(--color-text-secondary)]">
                  允许的 Source 类型
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {AUTHORABLE_NODE_TYPES.concat(["PHYSICAL_TABLE", "PHYSICAL_COLUMN"]).map(
                    (type) => (
                      <label key={`source-${type}`} className="flex items-center gap-2 text-[10px]">
                        <input
                          type="checkbox"
                          checked={proposedSources.includes(type)}
                          onChange={(event) =>
                            setProposedSources((current) =>
                              event.target.checked
                                ? [...current, type]
                                : current.filter((item) => item !== type),
                            )
                          }
                        />
                        {type}
                      </label>
                    ),
                  )}
                </div>
              </fieldset>
              <fieldset className="border border-[var(--color-border-default)] p-3 md:col-span-2">
                <legend className="px-1 text-[10px] text-[var(--color-text-secondary)]">
                  允许的 Target 类型
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {AUTHORABLE_NODE_TYPES.concat(["PHYSICAL_TABLE", "PHYSICAL_COLUMN"]).map(
                    (type) => (
                      <label key={`target-${type}`} className="flex items-center gap-2 text-[10px]">
                        <input
                          type="checkbox"
                          checked={proposedTargets.includes(type)}
                          onChange={(event) =>
                            setProposedTargets((current) =>
                              event.target.checked
                                ? [...current, type]
                                : current.filter((item) => item !== type),
                            )
                          }
                        />
                        {type}
                      </label>
                    ),
                  )}
                </div>
              </fieldset>
              <div className="border-l-2 border-[var(--color-border-overlay)] pl-3 text-[10px] leading-4 text-[#68746e] md:col-span-2 xl:col-span-4">
                此处只生成独立的 <span className="font-mono">ADD_EDGE_TYPE</span> Candidate
                operation，不会创建关系实例或直接修改正式
                Registry。保存、验证、自审和发布门禁保持不变。
              </div>
            </>
          ) : nodeMode ? (
            <>
              <label className="text-[10px] text-[var(--color-text-secondary)]">
                对象类型
                <select
                  className={`${fieldClass} mt-1`}
                  value={nodeType}
                  disabled={mode !== "ADD_NODE"}
                  onChange={(event) => setNodeType(event.target.value as SemanticNodeType)}
                >
                  {AUTHORABLE_NODE_TYPES.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] text-[var(--color-text-secondary)]">
                稳定 ID
                <input
                  className={`${fieldClass} mt-1 font-mono`}
                  value={nodeId}
                  disabled={mode !== "ADD_NODE"}
                  onChange={(event) => setNodeId(event.target.value)}
                />
              </label>
              <label className="text-[10px] text-[var(--color-text-secondary)]">
                名称
                <input
                  className={`${fieldClass} mt-1`}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="text-[10px] text-[var(--color-text-secondary)]">
                生命周期
                <select
                  className={`${fieldClass} mt-1`}
                  value={lifecycle}
                  onChange={(event) => setLifecycle(event.target.value as typeof lifecycle)}
                >
                  <option>ACTIVE</option>
                  <option>DEPRECATED</option>
                  <option>RETIRED</option>
                </select>
              </label>
              <label className="text-[10px] text-[var(--color-text-secondary)] md:col-span-2 xl:col-span-4">
                业务定义
                <textarea
                  className="mt-1 min-h-20 w-full border border-[var(--color-border-default)] p-3 text-xs outline-none focus:border-[var(--color-accent)]"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              {nodeType === "FORMULA" ? (
                <div className="text-[10px] text-[var(--color-text-secondary)] md:col-span-2 xl:col-span-4">
                  <p>公式构建器 · semantic-formula-ast@1</p>
                  <div className="mt-1 border border-[var(--color-border-default)] p-3">
                    <FormulaExpressionEditor
                      value={formulaExpression}
                      onChange={setFormulaExpression}
                    />
                  </div>
                  <span className="mt-1 block text-[9px] leading-4 text-[var(--color-text-muted)]">
                    保存前按 Formula AST 严格校验；非法字段、循环依赖或无法 Lower 的表达式会被拒绝。
                  </span>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <label className="text-[10px] text-[var(--color-text-secondary)]">
                已注册关系类型
                <select
                  className={`${fieldClass} mt-1`}
                  value={edgeType}
                  disabled={mode !== "ADD_EDGE"}
                  onChange={(event) => {
                    setEdgeType(event.target.value);
                    const next = editableEdgeTypes.find(
                      (item) => item.edge_type === event.target.value,
                    );
                    setSourceId(
                      nodes.find((node) => next?.source_node_types.includes(node.node_type))
                        ?.node_id ?? "",
                    );
                    setTargetId(
                      nodes.find((node) => next?.target_node_types.includes(node.node_type))
                        ?.node_id ?? "",
                    );
                  }}
                >
                  {editableEdgeTypes.map((type) => (
                    <option key={type.edge_type} value={type.edge_type}>
                      {type.display_name} · {type.edge_type}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] text-[var(--color-text-secondary)]">
                Edge ID
                <input
                  className={`${fieldClass} mt-1 font-mono`}
                  value={edgeId}
                  disabled={mode !== "ADD_EDGE"}
                  onChange={(event) => setEdgeId(event.target.value)}
                />
              </label>
              <label className="text-[10px] text-[var(--color-text-secondary)]">
                Source
                <select
                  className={`${fieldClass} mt-1`}
                  value={sourceId}
                  onChange={(event) => setSourceId(event.target.value)}
                >
                  {sourceNodes.map((node) => (
                    <option key={node.node_id} value={node.node_id}>
                      {node.name} · {node.node_type}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] text-[var(--color-text-secondary)]">
                Target
                <select
                  className={`${fieldClass} mt-1`}
                  value={targetId}
                  onChange={(event) => setTargetId(event.target.value)}
                >
                  {targetNodes.map((node) => (
                    <option key={node.node_id} value={node.node_id}>
                      {node.name} · {node.node_type}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] text-[var(--color-text-secondary)]">
                生命周期
                <select
                  className={`${fieldClass} mt-1`}
                  value={lifecycle}
                  onChange={(event) => setLifecycle(event.target.value as typeof lifecycle)}
                >
                  <option>ACTIVE</option>
                  <option>DEPRECATED</option>
                  <option>RETIRED</option>
                </select>
              </label>
              <div className="text-[10px] text-[var(--color-text-secondary)] md:col-span-2 xl:col-span-3">
                <p>关系属性 · {selectedDefinition?.attribute_kind ?? "未选择类型"}</p>
                <div className="mt-1 border border-[var(--color-border-default)] p-3">
                  <EdgeAttributesEditor value={edgeAttributes} onChange={setEdgeAttributes} />
                </div>
              </div>
              <div className="md:col-span-2 xl:col-span-4 flex items-center gap-2 border-l-2 border-[var(--color-border-overlay)] pl-3 text-[10px] text-[#68746e]">
                <Link className="size-4 text-[var(--color-accent)]" />
                端点与属性由注册类型约束。关系编辑器不允许临时创建新类型。
              </div>
            </>
          )}
          {error ? (
            <p className="md:col-span-2 xl:col-span-4 text-xs text-red-700">{error}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 md:col-span-2 xl:col-span-4">
            <button
              type="button"
              onClick={proposalMode ? applyEdgeTypeProposal : nodeMode ? applyNode : applyEdge}
              className="inline-flex h-9 items-center gap-2 bg-[var(--color-accent)] px-4 text-xs font-semibold text-white hover:bg-[var(--color-accent-hover)]"
            >
              {mode === "ADD_NODE" || mode === "PROPOSE_EDGE_TYPE" ? (
                <Plus className="size-4" />
              ) : mode === "ADD_EDGE" ? (
                <ArrowRight className="size-4" />
              ) : (
                <FloppyDisk className="size-4" />
              )}
              加入未保存 ChangeSet
            </button>
            {mode === "EDIT_SELECTION" ? (
              <button
                type="button"
                onClick={retire}
                className="inline-flex h-9 items-center gap-2 border border-red-200 px-4 text-xs font-semibold text-red-700 hover:bg-red-50"
              >
                <Trash className="size-4" />
                {selectedEdge ? "断开并退役" : "退役对象"}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
