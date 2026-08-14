import { describe, expect, it } from "vitest";
import {
  actionsForWorkspaceRole,
  appUserSchema,
  creditAccountSchema,
  fxRateCandidateSchema,
  identityCommandSchema,
  modelBillSchema,
  modelPriceCandidateSchema,
  semanticImportJobSchema,
  semanticWorkspaceExportSchema,
  workspaceAccessProjectionSchema,
  workspaceSchema,
} from "../src/index.js";

const ids = {
  app: "00000000-0000-4000-8000-00000000da01",
  workspace: "00000000-0000-4000-8000-00000000aa11",
  principal: "00000000-0000-4000-8000-000000001001",
  actor: "00000000-0000-4000-8000-000000001002",
  operation: "00000000-0000-4000-8000-000000001003",
  candidate: "00000000-0000-4000-8000-000000001004",
  component: "00000000-0000-4000-8000-000000001005",
  invocation: "00000000-0000-4000-8000-000000001006",
  bill: "00000000-0000-4000-8000-000000001007",
  price: "00000000-0000-4000-8000-000000001008",
} as const;

const at = "2026-08-14T08:00:00.000Z";
const hash = `sha256:${"a".repeat(64)}`;

function expectUnknownFieldRejected(
  schema: { safeParse(input: unknown): { success: boolean } },
  input: object,
) {
  expect(schema.safeParse({ ...input, caller_role: "SUPER_ADMIN" }).success).toBe(false);
}

describe("workspace and identity contracts", () => {
  const workspace = {
    schema_version: "workspace@1.0.0",
    app_id: ids.app,
    environment: "test",
    workspace_id: ids.workspace,
    slug: "bootstrap-workspace",
    display_name: "Bootstrap Workspace",
    lifecycle: "ACTIVE",
    lifecycle_version: 1,
    created_at: at,
    archived_at: null,
  } as const;

  it("uses workspace_id as the only public project boundary and rejects unknown fields", () => {
    expect(workspaceSchema.parse(workspace)).toEqual(workspace);
    expectUnknownFieldRejected(workspaceSchema, workspace);
    expect(workspaceSchema.safeParse({ ...workspace, workspace_id: "default" }).success).toBe(
      false,
    );
  });

  it("keeps global and workspace roles separate", () => {
    const user = {
      schema_version: "app-user@1.0.0",
      app_id: ids.app,
      environment: "test",
      principal_id: ids.principal,
      auth_user_id: "auth-user-1",
      email: "analyst@example.test",
      display_name: "Analyst",
      system_role: "USER",
      status: "ACTIVE",
      authz_epoch: 1,
      created_at: at,
      disabled_at: null,
    } as const;
    expect(appUserSchema.parse(user).system_role).toBe("USER");
    expect(appUserSchema.safeParse({ ...user, system_role: "WORKSPACE_ADMIN" }).success).toBe(
      false,
    );

    const analystActions = actionsForWorkspaceRole("ANALYST", "USER");
    expect(analystActions).toContain("ANALYSIS_RUN_CREATE");
    expect(analystActions).not.toContain("MEMBER_MANAGE");
    expect(actionsForWorkspaceRole("VIEWER", "SUPER_ADMIN")).toContain("CREDIT_MANAGE");
  });

  it("does not let a client expand an access projection", () => {
    const projection = {
      schema_version: "workspace-access@1.0.0",
      workspace,
      principal_id: ids.principal,
      system_role: "USER",
      role: "VIEWER",
      allowed_actions: ["WORKSPACE_RESULT_READ"],
    } as const;
    expect(workspaceAccessProjectionSchema.parse(projection)).toEqual(projection);
    expectUnknownFieldRejected(workspaceAccessProjectionSchema, projection);
  });

  it("strictly decodes idempotent identity commands", () => {
    const command = {
      schema_version: "identity-command@1.0.0",
      operation_id: ids.operation,
      idempotency_key: "create-user:001",
      kind: "CREATE_USER",
      email: "new-user@example.test",
      display_name: "New User",
      system_role: "USER",
    } as const;
    expect(identityCommandSchema.parse(command)).toEqual(command);
    expectUnknownFieldRejected(identityCommandSchema, command);
  });
});

describe("price, FX and credit contracts", () => {
  it("uses decimal/integer strings and explicit price dimensions", () => {
    const candidate = {
      schema_version: "model-price-candidate@1.0.0",
      candidate_id: ids.candidate,
      provider: "openai",
      model_id: "gpt-test",
      status: "PENDING_REVIEW",
      source_url: "https://example.test/pricing",
      evidence_hash: hash,
      parser_version: "openai-pricing@1.0.0",
      fetched_at: at,
      risk: "NORMAL",
      components: [
        {
          component_id: ids.component,
          kind: "INPUT_TOKENS",
          unit: "PER_MILLION_TOKENS",
          unit_price: "1.25",
          currency: "USD",
          tier_min_inclusive: "0",
          tier_max_exclusive: null,
        },
      ],
    } as const;
    expect(modelPriceCandidateSchema.parse(candidate)).toEqual(candidate);
    expect(
      modelPriceCandidateSchema.safeParse({
        ...candidate,
        components: [{ ...candidate.components[0], unit_price: 1.25 }],
      }).success,
    ).toBe(false);
    expectUnknownFieldRejected(modelPriceCandidateSchema, candidate);
  });

  it("keeps FX candidates pending until explicit approval", () => {
    const candidate = {
      schema_version: "fx-rate-candidate@1.0.0",
      candidate_id: ids.candidate,
      base_currency: "USD",
      quote_currency: "CNY",
      rate: "7.1254",
      official_date: "2026-08-14",
      source_url: "https://example.test/fx",
      evidence_hash: hash,
      parser_version: "official-fx@1.0.0",
      fetched_at: at,
      status: "PENDING_REVIEW",
    } as const;
    expect(fxRateCandidateSchema.parse(candidate).status).toBe("PENDING_REVIEW");
    expectUnknownFieldRejected(fxRateCandidateSchema, candidate);
  });

  it("forbids negative available balances and snapshots bill attribution", () => {
    const account = {
      schema_version: "credit-account@1.0.0",
      app_id: ids.app,
      environment: "test",
      principal_id: ids.principal,
      settled_microcredits: "100000000",
      active_held_microcredits: "25000000",
      available_microcredits: "75000000",
      version: 1,
      updated_at: at,
    } as const;
    expect(creditAccountSchema.parse(account)).toEqual(account);
    expect(
      creditAccountSchema.safeParse({ ...account, available_microcredits: "-1" }).success,
    ).toBe(false);

    const bill = {
      schema_version: "model-bill@1.0.0",
      bill_id: ids.bill,
      app_id: ids.app,
      environment: "test",
      principal_id: ids.principal,
      workspace_id: ids.workspace,
      invocation_id: ids.invocation,
      run_id: null,
      conversation_id: null,
      provider: "openai",
      model_id: "gpt-test",
      funding_type: "USER_CREDITS",
      state: "SETTLED",
      price_version_id: ids.price,
      fx_version_id: ids.candidate,
      official_currency: "USD",
      official_cost: "0.01",
      cny_cost: "0.071254",
      charged_microcredits: "7125400",
      usage: {
        input_tokens: "100",
        output_tokens: "20",
        cache_read_tokens: "0",
        cache_write_tokens: "0",
        tool_calls: "0",
      },
      formula_version: "credits@1.0.0",
      created_at: at,
      settled_at: at,
    } as const;
    expect(modelBillSchema.parse(bill)).toEqual(bill);
    expectUnknownFieldRejected(modelBillSchema, bill);
  });
});

describe("semantic workspace portability contracts", () => {
  it("exports portable published semantics without a source workspace identifier", () => {
    const exported = {
      format: "semantic-workspace-export@1.0.0",
      exported_at: at,
      source_release_version: "semantic-release@1.0.0",
      content_hash: hash,
      datasource_refs: [
        {
          logical_ref: "warehouse-primary",
          display_name: "Warehouse",
          dialect: "postgresql",
          schema_fingerprint: hash,
        },
      ],
      compatibility: {
        semantic_protocol_version: "semantic@1.0.0",
        minimum_importer_version: "data-agent@0.1.0",
      },
      published_semantic: { metrics: [] },
    } as const;
    expect(semanticWorkspaceExportSchema.parse(exported)).toEqual(exported);
    expectUnknownFieldRejected(semanticWorkspaceExportSchema, exported);
    expect(JSON.stringify(exported)).not.toContain(ids.workspace);
  });

  it("requires explicit datasource mappings before READY", () => {
    const base = {
      schema_version: "semantic-import-job@1.0.0",
      import_id: ids.operation,
      workspace_id: ids.workspace,
      upload_hash: hash,
      created_at: at,
      updated_at: at,
    } as const;
    expect(
      semanticImportJobSchema.safeParse({ ...base, state: "READY", mappings: [] }).success,
    ).toBe(false);
    expect(
      semanticImportJobSchema.safeParse({
        ...base,
        state: "READY",
        mappings: [{ logical_ref: "warehouse-primary", target_datasource_id: ids.candidate }],
      }).success,
    ).toBe(true);
  });
});
