import {
  BUILTIN_SEMANTIC_EDGE_TYPES,
  BUILTIN_SEMANTIC_NODE_TYPES,
  buildOntologyPackageCandidate,
  deriveOntologyNamespaceId,
  deriveOntologyPackageId,
  deriveOntologyStableObjectId,
  ONTOLOGY_PACKAGE_VERSION,
} from "@data-agent/contracts";

const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

export async function createOntologyPackageFixture() {
  const namespaceBase = {
    app_id: "00000000-0000-4000-8000-000000000411",
    tenant_id: "00000000-0000-4000-8000-000000000412",
    workspace_id: "00000000-0000-4000-8000-000000000412",
    environment: "test",
    semantic_domain: "commerce",
  } as const;
  const namespace = {
    ...namespaceBase,
    namespace_id: await deriveOntologyNamespaceId(namespaceBase),
  };
  const subjectSource = {
    source_class: "BUSINESS_CONTEXT" as const,
    source_role: "BUSINESS_SOURCE_BUNDLE" as const,
    namespace_id: namespace.namespace_id,
    source_id: "00000000-0000-4000-8000-000000000413",
    source_version: 1,
    source_hash: hash("3"),
    object_path: ["subjects", "order"],
  };
  const dimensionSource = { ...subjectSource, object_path: ["dimensions", "region"] };
  const subjectId = await deriveOntologyStableObjectId({
    namespace,
    source: subjectSource,
    semantic_role: "ENTITY",
  });
  const dimensionId = await deriveOntologyStableObjectId({
    namespace,
    source: dimensionSource,
    semantic_role: "DATA_PROPERTY",
  });
  const common = {
    node_version: 1,
    aliases: [] as string[],
    owner_ref: "data-team",
    lifecycle: "ACTIVE" as const,
    evidence_refs: [] as string[],
    tags: [] as string[],
  };

  return buildOntologyPackageCandidate({
    schema_version: ONTOLOGY_PACKAGE_VERSION,
    namespace,
    package_id: await deriveOntologyPackageId(namespace),
    package_version: 1,
    status: "CANDIDATE",
    source_binding: {
      schema_snapshot: {
        source_class: "SCHEMA",
        source_role: "SCHEMA_SNAPSHOT",
        namespace_id: namespace.namespace_id,
        source_id: "00000000-0000-4000-8000-000000000414",
        source_version: 1,
        source_hash: hash("4"),
        object_path: ["snapshot"],
      },
      business_source_bundle: { ...subjectSource, object_path: ["bundle"] },
      policy: {
        source_class: "POLICY",
        source_role: "POLICY_DIGEST",
        namespace_id: namespace.namespace_id,
        source_id: "00000000-0000-4000-8000-000000000415",
        source_version: 1,
        source_hash: hash("5"),
        object_path: ["policy"],
      },
      datasource_id: "00000000-0000-4000-8000-000000000416",
    },
    dependencies: [],
    imports: [],
    objects: [
      {
        object_id: subjectId,
        graph_entry_kind: "NODE",
        graph_entry_id: "subject-order",
        source: subjectSource,
        semantic_role: "ENTITY",
        resolution: "RESOLVED",
      },
      {
        object_id: dimensionId,
        graph_entry_kind: "NODE",
        graph_entry_id: "dimension-region",
        source: dimensionSource,
        semantic_role: "DATA_PROPERTY",
        resolution: "UNRESOLVED",
      },
    ],
    business_subjects: [{ object_id: subjectId, graph_node_id: "subject-order", role: "ENTITY" }],
    dimensions: [
      {
        object_id: dimensionId,
        graph_node_id: "dimension-region",
        data_type: "text",
        unit_object_id: null,
        sensitivity: "PUBLIC",
        required: false,
      },
    ],
    edge_semantics: [],
    constraints: [],
    physical_mappings: [],
    metric_bindings: [],
    graph_source: {
      metadata: {
        graph_version: "semantic-graph-source@2",
        graph_id: "00000000-0000-4000-8000-000000000417",
        domain_id: namespace.semantic_domain,
        base_release_id: null,
        capability_profile: "U5_EXECUTABLE_SUBSET",
        scope: {
          app_id: namespace.app_id,
          tenant_id: namespace.tenant_id,
          environment: namespace.environment,
        },
        producer: { kind: "deterministic", id: "u4-fixture" },
        authority: {
          kind: "deterministic",
          id: "ontology-package-validator",
          policy_version: "ontology-package-validator@1.0.0",
        },
        created_at: "2026-08-17T00:00:00.000Z",
      },
      node_type_registry: BUILTIN_SEMANTIC_NODE_TYPES,
      edge_type_registry: BUILTIN_SEMANTIC_EDGE_TYPES,
      evidence: [],
      nodes: [
        {
          ...common,
          node_id: "subject-order",
          node_type: "BUSINESS_SUBJECT",
          name: "订单",
          domain: namespace.semantic_domain,
        },
        {
          ...common,
          node_id: "dimension-region",
          node_type: "DIMENSION",
          name: "区域",
          data_type: "text",
          sensitivity: "PUBLIC",
          filter_semantics: "EXACT",
          analysis: { groupable: true, pivotable: true, causal_role: null },
        },
      ],
      edges: [],
    },
    mandatory_manifest: {
      manifest_version: "mandatory-release-manifest@1.0.0",
      node_object_ids: [subjectId],
      edge_object_ids: [],
      constraint_ids: [],
      mapping_ids: [],
      metric_object_ids: [],
    },
  });
}
