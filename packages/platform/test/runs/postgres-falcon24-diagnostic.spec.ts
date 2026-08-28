import {
  buildFalcon24DiagnosticAttempt,
  buildFalcon24DiagnosticReceipt,
  FALCON24_E4_DIAGNOSTIC_QUESTION,
  sha256ContentHash,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresFalcon24DiagnosticAuthority } from "../../src/runs/postgres-falcon24-diagnostic.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const now = "2026-08-28T12:00:00.000Z";
const ids = { app: id(1), tenant: id(2), analyst: id(3), deployment: id(4), run: id(5) };

function authority() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      {
        subject: ids.analyst,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role: "ANALYST",
      },
    ],
  );
  const capability = registry.resolveForDeployment(ids.deployment, { subject: ids.analyst });
  if (!capability.ok) throw new Error("authority fixture failed");
  return {
    capability: capability.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

const authorityBinding = {
  schema_version: "falcon24-authority-binding@2.0.0" as const,
  authority_epoch: "E4" as const,
  baseline_id: id(10),
  baseline_hash: hash("a"),
  activation_attempt_id: id(11),
};
const semanticRelease = {
  release_id: id(12),
  generation: 2,
  release_digest: hash("b"),
  datasource_id: id(13),
};

async function manifest() {
  return buildFalcon24DiagnosticAttempt({
    schema_version: "falcon24-diagnostic-attempt@1.0.0",
    attempt_id: id(14),
    run_id: ids.run,
    authority: authorityBinding,
    semantic_release: semanticRelease,
    source_commit: "a".repeat(40),
    source_fingerprint: hash("c"),
    web_build: { build_id: hash("d"), generation_id: hash("e") },
    worker_build: { build_id: hash("f"), generation_id: hash("1") },
    runtime_attestation_hash: hash("2"),
    question: FALCON24_E4_DIAGNOSTIC_QUESTION,
    question_hash: await sha256ContentHash(FALCON24_E4_DIAGNOSTIC_QUESTION),
  });
}

function row(
  document: Awaited<ReturnType<typeof manifest>>,
  overrides: Record<string, unknown> = {},
) {
  return {
    app_id: ids.app,
    tenant_id: ids.tenant,
    environment: "test",
    principal_id: ids.analyst,
    attempt_id: document.attempt_id,
    run_id: document.run_id,
    authority_epoch: "E4",
    authority_baseline_id: authorityBinding.baseline_id,
    authority_baseline_hash: authorityBinding.baseline_hash,
    authority_activation_attempt_id: authorityBinding.activation_attempt_id,
    semantic_domain: "default",
    semantic_release_id: semanticRelease.release_id,
    semantic_release_generation: 2,
    semantic_release_digest: semanticRelease.release_digest,
    datasource_id: semanticRelease.datasource_id,
    source_commit: document.source_commit,
    source_fingerprint: document.source_fingerprint,
    web_build_id: document.web_build.build_id,
    web_generation_id: document.web_build.generation_id,
    worker_build_id: document.worker_build.build_id,
    worker_generation_id: document.worker_build.generation_id,
    runtime_attestation_hash: document.runtime_attestation_hash,
    question_hash: document.question_hash,
    manifest_hash: document.manifest_hash,
    manifest_document: document,
    status: "ACTIVE",
    failure_class: null,
    failure_code: null,
    terminal_receipt_hash: null,
    created_at: now,
    completed_at: null,
    ...overrides,
  };
}

function scriptedPool(handler: (text: string, values?: readonly unknown[]) => unknown) {
  const calls: { readonly text: string; readonly values?: readonly unknown[] }[] = [];
  const client: SqlClient = {
    async query<Row extends object = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ) {
      calls.push({ text, ...(values ? { values } : {}) });
      if (text.includes("backend_context_matches")) {
        return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
      }
      const value = handler(text, values);
      return {
        rows: value === undefined ? [] : [{ value }],
        rowCount: value === undefined ? 0 : 1,
      } as unknown as SqlQueryResult<Row>;
    },
    release() {},
  };
  return { calls, pool: { connect: async () => client } satisfies SqlPool };
}

describe("PostgreSQL Falcon24 diagnostic authority", () => {
  it("begins one exact E4 generation 2 diagnostic attempt", async () => {
    const auth = authority();
    const candidate = await manifest();
    const scripted = scriptedPool((text) =>
      text.includes("begin_falcon24_diagnostic") ? row(candidate) : undefined,
    );
    const result = await createPostgresFalcon24DiagnosticAuthority({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    }).begin(auth.capability, candidate);

    expect(result).toMatchObject({ ok: true, value: { status: "ACTIVE", run_id: ids.run } });
    expect(
      scripted.calls.find(({ text }) => text.includes("set_config('app.semantic_domain'"))?.values,
    ).toEqual(["falcon24"]);
    expect(
      scripted.calls.find(({ text }) => text.includes("begin_falcon24_diagnostic"))?.values,
    ).toEqual([
      expect.objectContaining({
        schema_version: "falcon24-diagnostic-begin@1.0.0",
        manifest: candidate,
        command_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      }),
    ]);
  });

  it("terminally records an external diagnostic failure", async () => {
    const auth = authority();
    const candidate = await manifest();
    const receipt = await buildFalcon24DiagnosticReceipt({
      schema_version: "falcon24-diagnostic-receipt@1.0.0",
      attempt_id: candidate.attempt_id,
      run_id: candidate.run_id,
      attempt_manifest_hash: candidate.manifest_hash,
      authority: authorityBinding,
      semantic_release: semanticRelease,
      outcome: "FAIL",
      pass_evidence: null,
      failure_class: "EXTERNAL_DEPENDENCY",
      failure_code: "PROVIDER_UNAVAILABLE",
      completed_at: now,
    });
    const scripted = scriptedPool((text) =>
      text.includes("complete_falcon24_diagnostic") ? receipt : undefined,
    );
    const result = await createPostgresFalcon24DiagnosticAuthority({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    }).complete(auth.capability, {
      attempt_id: candidate.attempt_id,
      outcome: "FAIL",
      failure_class: "EXTERNAL_DEPENDENCY",
      failure_code: "PROVIDER_UNAVAILABLE",
    });

    expect(result).toMatchObject({ ok: true, value: { outcome: "FAIL" } });
  });
});
