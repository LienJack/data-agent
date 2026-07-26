import {
  type ArtifactReference,
  artifactReferenceIdentity,
  computeL2ArtifactContentHash,
  type L2ArtifactDocument,
  type L2ArtifactPersistenceAuthority,
  l2ArtifactDocumentSchema,
  type QueryContractPayload,
  verifyL2ArtifactDocument,
} from "@data-agent/contracts";

export const fixtureIds = {
  app: "00000000-0000-4000-8000-000000000001",
  tenant: "00000000-0000-4000-8000-000000000002",
  run: "00000000-0000-4000-8000-000000000003",
  evidencePlan: "00000000-0000-4000-8000-000000000004",
  questionFrame: "00000000-0000-4000-8000-000000000005",
  attempt: "00000000-0000-4000-8000-000000000006",
} as const;

export const fixturePrincipalId = "analyst@example.test";
export const fixtureScope = {
  app_id: fixtureIds.app,
  tenant_id: fixtureIds.tenant,
  environment: "test",
} as const;

export function artifactReference<const T extends ArtifactReference["artifact_type"]>(
  artifactType: T,
  artifactId = fixtureIds.evidencePlan,
): ArtifactReference & { artifact_type: T } {
  return {
    artifact_id: artifactId,
    artifact_type: artifactType,
    app_id: fixtureIds.app,
    tenant_id: fixtureIds.tenant,
    environment: "test",
    run_id: fixtureIds.run,
    revision: 1,
    content_hash: `sha256:${"a".repeat(64)}`,
  } as ArtifactReference & { artifact_type: T };
}

export function questionFrameAuthority(
  document: L2ArtifactDocument,
  currentCommitted = true,
): L2ArtifactPersistenceAuthority {
  const reference = {
    artifact_id: document.envelope.artifact_id,
    artifact_type: document.envelope.artifact_type,
    app_id: document.envelope.app_id,
    tenant_id: document.envelope.tenant_id,
    environment: document.envelope.environment,
    run_id: document.envelope.run_id,
    revision: document.envelope.revision,
    content_hash: document.envelope.content_hash,
  } satisfies ArtifactReference;
  return {
    principalId: fixturePrincipalId,
    verifyCommitted: async (candidate) =>
      currentCommitted &&
      artifactReferenceIdentity(candidate) === artifactReferenceIdentity(reference),
    resolveL2: async () => null,
    verifyCommitterCapability: async () => true,
  };
}

export async function verifiedQuestionFrame(
  authorizedDatasourceIds: readonly string[] = [fixtureIds.app],
): Promise<L2ArtifactDocument> {
  const draft = l2ArtifactDocumentSchema.parse({
    envelope: {
      artifact_id: fixtureIds.questionFrame,
      artifact_type: "QuestionFrame",
      app_id: fixtureIds.app,
      tenant_id: fixtureIds.tenant,
      environment: "test",
      run_id: fixtureIds.run,
      revision: 1,
      parent_ref: null,
      attempt_id: fixtureIds.attempt,
      producer: { kind: "deterministic", id: "question-frame-compiler" },
      input_refs: [],
      schema_version: "data-agent-artifact/v1",
      semantic_version: "question-frame@1.0.0",
      policy_version: "default-policy@1.0.0",
      model_profile_version: "deterministic",
      content_hash: `sha256:${"0".repeat(64)}`,
      status: "COMMITTED",
      created_at: "2026-07-26T00:00:00.000Z",
    },
    payload: {
      artifact_type: "QuestionFrame",
      raw_question: "华南区净收入为什么下降？",
      normalized_question: "解释华南区净收入下降的支持证据",
      authorized_datasource_ids: authorizedDatasourceIds,
      expected_output: "多步研究报告",
    },
  });
  const document = l2ArtifactDocumentSchema.parse({
    ...draft,
    envelope: {
      ...draft.envelope,
      content_hash: await computeL2ArtifactContentHash(draft),
    },
  });
  return verifyL2ArtifactDocument(document, questionFrameAuthority(document));
}

export function netRevenueContract(
  overrides: Partial<QueryContractPayload> = {},
): QueryContractPayload {
  return {
    artifact_type: "QueryContract",
    evidence_plan_ref: artifactReference("EvidencePlan"),
    metric: "metric.net_revenue",
    dimensions: ["dimension.customer_segment"],
    grain: "order",
    time_range: {
      start: "2026-06-01T00:00:00.000+08:00",
      end: "2026-07-01T00:00:00.000+08:00",
      timezone: "Asia/Shanghai",
      semantics: "HALF_OPEN",
    },
    unit: "CNY",
    filters: [{ field: "orders.status", operator: "eq", value: "paid" }],
    datasource_id: fixtureIds.app,
    result_contract: {
      columns: ["dimension.customer_segment", "metric.net_revenue"],
      invariant_ids: ["non_negative_revenue"],
    },
    ...overrides,
  };
}

export const commerceCatalog = {
  scope: fixtureScope,
  run_id: fixtureIds.run,
  catalog_version: "commerce-catalog@1.0.0",
  datasource_id: fixtureIds.app,
  tables: [
    {
      table_id: "orders",
      physical_name: "orders",
      columns: [
        {
          column_id: "orders.id",
          physical_name: "id",
          data_type: "uuid",
          nullable: false,
          sensitivity: "INTERNAL",
        },
        {
          column_id: "orders.customer_id",
          physical_name: "customer_id",
          data_type: "uuid",
          nullable: false,
          sensitivity: "INTERNAL",
        },
        {
          column_id: "orders.created_at",
          physical_name: "created_at",
          data_type: "timestamptz",
          nullable: false,
          sensitivity: "INTERNAL",
        },
        {
          column_id: "orders.net_amount",
          physical_name: "net_amount",
          data_type: "numeric",
          nullable: true,
          sensitivity: "INTERNAL",
        },
        {
          column_id: "orders.status",
          physical_name: "status",
          data_type: "text",
          nullable: false,
          sensitivity: "INTERNAL",
        },
        {
          column_id: "orders.tenant_id",
          physical_name: "tenant_id",
          data_type: "uuid",
          nullable: false,
          sensitivity: "RESTRICTED",
        },
      ],
    },
    {
      table_id: "customers",
      physical_name: "customers",
      columns: [
        {
          column_id: "customers.id",
          physical_name: "id",
          data_type: "uuid",
          nullable: false,
          sensitivity: "INTERNAL",
        },
        {
          column_id: "customers.segment",
          physical_name: "segment",
          data_type: "text",
          nullable: true,
          sensitivity: "INTERNAL",
        },
        {
          column_id: "customers.tenant_id",
          physical_name: "tenant_id",
          data_type: "uuid",
          nullable: false,
          sensitivity: "RESTRICTED",
        },
      ],
    },
    {
      table_id: "executive_revenue",
      physical_name: "executive_revenue",
      columns: [
        {
          column_id: "executive_revenue.net_amount",
          physical_name: "net_amount",
          data_type: "numeric",
          nullable: false,
          sensitivity: "SECRET",
        },
      ],
    },
  ],
  relationships: [
    {
      relationship_id: "orders_customer",
      left_table_id: "orders",
      left_column_ids: ["orders.customer_id"],
      right_table_id: "customers",
      right_column_ids: ["customers.id"],
      cardinality: "many-to-one",
      left_row_match: "required",
      right_row_match: "optional",
    },
  ],
  metrics: [
    {
      metric_id: "metric.net_revenue",
      aliases: ["净收入", "收入"],
      table_id: "orders",
      column_id: "orders.net_amount",
      aggregation: "sum",
      grain: "order",
      unit: "CNY",
      time_column_id: "orders.created_at",
      additivity: "additive",
      null_policy: "coalesce-zero",
      dependency_column_ids: ["orders.net_amount"],
      fanout_policy: "preaggregate",
    },
    {
      metric_id: "metric.executive_revenue",
      aliases: ["收入"],
      table_id: "executive_revenue",
      column_id: "executive_revenue.net_amount",
      aggregation: "sum",
      grain: "executive",
      unit: "CNY",
      time_column_id: null,
      additivity: "additive",
      null_policy: "preserve",
      dependency_column_ids: ["executive_revenue.net_amount"],
      fanout_policy: "reject",
    },
  ],
  dimensions: [
    {
      dimension_id: "dimension.customer_segment",
      aliases: ["客户分层"],
      table_id: "customers",
      column_id: "customers.segment",
      grain: "customer",
    },
  ],
} as const;

export const analystPolicy = {
  scope: fixtureScope,
  run_id: fixtureIds.run,
  policy_version: "analyst-policy@1.0.0",
  datasource_id: fixtureIds.app,
  principal_id: fixturePrincipalId,
  allowed_tables: [
    {
      table_id: "orders",
      column_ids: [
        "orders.id",
        "orders.customer_id",
        "orders.created_at",
        "orders.net_amount",
        "orders.status",
        "orders.tenant_id",
      ],
    },
    {
      table_id: "customers",
      column_ids: ["customers.id", "customers.segment", "customers.tenant_id"],
    },
  ],
  mandatory_predicates: [
    {
      table_id: "orders",
      column_id: "orders.tenant_id",
      operator: "eq",
      parameter_key: "tenant_id",
    },
    {
      table_id: "customers",
      column_id: "customers.tenant_id",
      operator: "eq",
      parameter_key: "tenant_id",
    },
  ],
} as const;

export const fanoutCatalog = {
  scope: fixtureScope,
  run_id: fixtureIds.run,
  catalog_version: "fanout-catalog@1.0.0",
  datasource_id: fixtureIds.app,
  tables: [
    {
      table_id: "payments",
      physical_name: "payments",
      columns: [
        {
          column_id: "payments.order_id",
          physical_name: "order_id",
          data_type: "uuid",
          nullable: false,
          sensitivity: "INTERNAL",
        },
        {
          column_id: "payments.amount",
          physical_name: "amount",
          data_type: "numeric",
          nullable: false,
          sensitivity: "INTERNAL",
        },
        {
          column_id: "payments.created_at",
          physical_name: "created_at",
          data_type: "timestamptz",
          nullable: false,
          sensitivity: "INTERNAL",
        },
        {
          column_id: "payments.tenant_id",
          physical_name: "tenant_id",
          data_type: "uuid",
          nullable: false,
          sensitivity: "RESTRICTED",
        },
      ],
    },
    {
      table_id: "orders",
      physical_name: "orders",
      columns: [
        {
          column_id: "orders.id",
          physical_name: "id",
          data_type: "uuid",
          nullable: false,
          sensitivity: "INTERNAL",
        },
        {
          column_id: "orders.tenant_id",
          physical_name: "tenant_id",
          data_type: "uuid",
          nullable: false,
          sensitivity: "RESTRICTED",
        },
      ],
    },
    {
      table_id: "order_items",
      physical_name: "order_items",
      columns: [
        {
          column_id: "order_items.order_id",
          physical_name: "order_id",
          data_type: "uuid",
          nullable: false,
          sensitivity: "INTERNAL",
        },
        {
          column_id: "order_items.sku",
          physical_name: "sku",
          data_type: "text",
          nullable: false,
          sensitivity: "INTERNAL",
        },
        {
          column_id: "order_items.tenant_id",
          physical_name: "tenant_id",
          data_type: "uuid",
          nullable: false,
          sensitivity: "RESTRICTED",
        },
      ],
    },
  ],
  relationships: [
    {
      relationship_id: "payments_order",
      left_table_id: "payments",
      left_column_ids: ["payments.order_id"],
      right_table_id: "orders",
      right_column_ids: ["orders.id"],
      cardinality: "many-to-one",
      left_row_match: "required",
      right_row_match: "optional",
    },
    {
      relationship_id: "order_items_order",
      left_table_id: "orders",
      left_column_ids: ["orders.id"],
      right_table_id: "order_items",
      right_column_ids: ["order_items.order_id"],
      cardinality: "one-to-many",
      left_row_match: "optional",
      right_row_match: "required",
    },
  ],
  metrics: [
    {
      metric_id: "metric.payment_amount",
      aliases: ["支付金额"],
      table_id: "payments",
      column_id: "payments.amount",
      aggregation: "sum",
      grain: "payment",
      unit: "CNY",
      time_column_id: "payments.created_at",
      additivity: "additive",
      null_policy: "preserve",
      dependency_column_ids: ["payments.amount"],
      fanout_policy: "preaggregate",
    },
  ],
  dimensions: [
    {
      dimension_id: "dimension.item_sku",
      aliases: ["商品 SKU"],
      table_id: "order_items",
      column_id: "order_items.sku",
      grain: "item",
    },
  ],
} as const;

export const fanoutPolicy = {
  scope: fixtureScope,
  run_id: fixtureIds.run,
  policy_version: "fanout-policy@1.0.0",
  datasource_id: fixtureIds.app,
  principal_id: fixturePrincipalId,
  allowed_tables: fanoutCatalog.tables.map((table) => ({
    table_id: table.table_id,
    column_ids: table.columns.map(({ column_id }) => column_id),
  })),
  mandatory_predicates: fanoutCatalog.tables.map((table) => ({
    table_id: table.table_id,
    column_id: `${table.table_id}.tenant_id`,
    operator: "eq" as const,
    parameter_key: "tenant_id",
  })),
} as const;

export function paymentBySkuContract(): QueryContractPayload {
  return netRevenueContract({
    metric: "metric.payment_amount",
    dimensions: ["dimension.item_sku"],
    grain: "item",
    filters: [],
    result_contract: {
      columns: ["dimension.item_sku", "metric.payment_amount"],
      invariant_ids: ["payment_total_fanout_invariant"],
    },
  });
}
