import {
  canonicalizeJson,
  computeL2ArtifactContentHash,
  type L2ArtifactDocument,
  l2ArtifactDocumentSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { createPostgresRepository } from "../../src/persistence/repository.js";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "00000000-0000-4000-8000-000000000001",
  tenant: "00000000-0000-4000-8000-000000000011",
  principal: "00000000-0000-4000-8000-000000000101",
  run: "00000000-0000-4000-8000-000000000201",
  command: "00000000-0000-4000-8000-000000000301",
  event: "00000000-0000-4000-8000-000000000401",
  outbox: "00000000-0000-4000-8000-000000000501",
  browserOutbox: "00000000-0000-4000-8000-000000000502",
  audit: "00000000-0000-4000-8000-000000000601",
  deployment: "00000000-0000-4000-8000-0000000000d1",
};
const canonicalPayloadHash = `sha256:${"a".repeat(64)}`;

function issueCapability() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      {
        subject: ids.principal,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role: "ANALYST",
      },
    ],
  );
  const result = registry.resolveForDeployment(ids.deployment, { subject: ids.principal });
  if (!result.ok) throw new Error("Capability fixture 创建失败。");
  return {
    capability: result.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

function scriptedPool(
  handle: (text: string, values: readonly unknown[]) => SqlQueryResult | undefined,
) {
  const calls: QueryCall[] = [];
  let released = 0;
  const client: SqlClient = {
    async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
      calls.push({ text, values });
      const handled = handle(text, values);
      if (handled) return handled as SqlQueryResult<Row>;
      if (text.includes("backend_context_matches")) {
        return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
      }
      if (text.includes("platform.canonical_sha256")) {
        return {
          rows: [{ payload_hash: canonicalPayloadHash }],
          rowCount: 1,
        } as unknown as SqlQueryResult<Row>;
      }
      return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
    },
    release() {
      released += 1;
    },
  };
  const pool: SqlPool = { connect: async () => client };
  return { calls, pool, released: () => released };
}

function commandInput() {
  return {
    run_id: ids.run,
    command_id: ids.command,
    event_id: ids.event,
    outbox_id: ids.outbox,
    audit_id: ids.audit,
    idempotency_key: "request-1",
    question: "华南区净收入同比为什么下降？",
    payload: {
      kind: "START_L2_RESEARCH",
      question_version: "v1",
      secret_refs: ["secretref:00000000-0000-4000-8000-000000000801"],
    },
  };
}

async function committedDocument(input: {
  readonly artifact_id: string;
  readonly artifact_type: "QuestionFrame" | "ExecutionReceipt";
  readonly revision?: number;
  readonly parent_ref?: Record<string, unknown> | null;
  readonly input_refs?: readonly Record<string, unknown>[];
  readonly payload: Record<string, unknown>;
}): Promise<L2ArtifactDocument> {
  const draft = l2ArtifactDocumentSchema.parse({
    envelope: {
      artifact_id: input.artifact_id,
      artifact_type: input.artifact_type,
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "test",
      run_id: ids.run,
      revision: input.revision ?? 1,
      parent_ref: input.parent_ref ?? null,
      attempt_id: "00000000-0000-4000-8000-000000000901",
      producer: { kind: "deterministic", id: "platform-test" },
      input_refs: input.input_refs ?? [],
      schema_version: "1.0.0",
      semantic_version: "1.0.0",
      policy_version: "1.0.0",
      model_profile_version: "test",
      content_hash: `sha256:${"0".repeat(64)}`,
      status: "COMMITTED",
      created_at: "2026-07-25T00:00:00.000Z",
    },
    payload: input.payload,
  });
  return l2ArtifactDocumentSchema.parse({
    ...draft,
    envelope: {
      ...draft.envelope,
      content_hash: await computeL2ArtifactContentHash(draft),
    },
  });
}

describe("PostgreSQL authoritative repository", () => {
  it("accepts command, idempotency, initial event and outbox in one transaction", async () => {
    const fixture = scriptedPool((text) => {
      if (text.includes("accept_backend_run_command")) {
        return {
          rows: [
            {
              result: {
                created: true,
                run_id: ids.run,
                command_id: ids.command,
                outbox_id: ids.outbox,
                payload_hash: canonicalPayloadHash,
              },
            },
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    const result = await repository.acceptCommand(authority.capability, commandInput());

    expect(result).toMatchObject({
      ok: true,
      value: {
        created: true,
        run_id: ids.run,
        command_id: ids.command,
        outbox_id: ids.outbox,
        payload_hash: canonicalPayloadHash,
      },
    });
    const statements = fixture.calls.map(({ text }) => text);
    expect(statements[0]).toBe("BEGIN");
    expect(statements).toContainEqual(expect.stringContaining("accept_backend_run_command"));
    expect(statements.some((text) => text.includes("insert into"))).toBe(false);
    expect(statements.at(-1)).toBe("COMMIT");
    const canonicalHashQuery = fixture.calls.find(({ text }) =>
      text.includes("platform.canonical_sha256"),
    );
    expect(canonicalHashQuery?.values).toEqual([canonicalizeJson(commandInput().payload)]);
    const acceptance = fixture.calls.find(({ text }) =>
      text.includes("accept_backend_run_command"),
    );
    expect(JSON.parse(String(acceptance?.values[0]))).toEqual(commandInput());
    expect(acceptance?.values[1]).toBe(canonicalPayloadHash);
    const initialEvent = JSON.parse(String(acceptance?.values[2]));
    expect(initialEvent).toMatchObject({
      event_id: ids.event,
      event_type: "run.accepted",
      payload: {
        command_id: ids.command,
        payload_hash: canonicalPayloadHash,
      },
    });
    expect(acceptance?.values[3]).toBe(await sha256ContentHash(initialEvent));
    expect(fixture.released()).toBe(1);
  });

  it("rejects unknown or opaque credential payload fields before database I/O", async () => {
    const fixture = scriptedPool(() => undefined);
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    expect(
      await repository.acceptCommand(authority.capability, {
        ...commandInput(),
        payload: {
          kind: "START_L2_RESEARCH",
          jdbc_url: "jdbc:postgresql://admin:hunter2@db.example.com/warehouse",
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_INPUT_INVALID", retryable: false },
    });
    expect(fixture.calls).toEqual([]);
  });

  it("rejects non-initial command kinds before database I/O", async () => {
    const fixture = scriptedPool(() => undefined);
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    expect(
      await repository.acceptCommand(authority.capability, {
        ...commandInput(),
        payload: {
          ...commandInput().payload,
          kind: "RESUME_RUN",
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_INPUT_INVALID", retryable: false },
    });
    expect(fixture.calls).toEqual([]);
  });

  it("rejects plaintext credentials pasted into the question before database I/O", async () => {
    const fixture = scriptedPool(() => undefined);
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    expect(
      await repository.acceptCommand(authority.capability, {
        ...commandInput(),
        question: "请连接 jdbc:postgresql://admin:hunter2@db.example.com/warehouse",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_INPUT_INVALID", retryable: false },
    });
    expect(fixture.calls).toEqual([]);
  });

  it("returns an existing command only when all idempotency bindings match", async () => {
    const input = commandInput();
    const fixture = scriptedPool((text) => {
      if (text.includes("accept_backend_run_command")) {
        return {
          rows: [
            {
              result: {
                created: false,
                command_id: ids.command,
                payload_hash: canonicalPayloadHash,
                run_id: ids.run,
                outbox_id: ids.browserOutbox,
              },
            },
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);
    const first = await repository.acceptCommand(authority.capability, input);

    expect(first).toMatchObject({
      ok: true,
      value: {
        created: false,
        command_id: ids.command,
        outbox_id: ids.browserOutbox,
      },
    });
    expect(fixture.calls.some(({ text }) => text.includes("insert into"))).toBe(false);
    expect(fixture.calls.at(-1)?.text).toBe("COMMIT");
  });

  it("rolls back a reused idempotency key with a different payload", async () => {
    const fixture = scriptedPool((text) => {
      if (text.includes("accept_backend_run_command")) {
        throw new Error("DA_COMMAND_IDEMPOTENCY_CONFLICT");
      }
      return undefined;
    });
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    const result = await repository.acceptCommand(authority.capability, commandInput());

    expect(result).toMatchObject({
      ok: false,
      error: { code: "COMMAND_IDEMPOTENCY_CONFLICT", retryable: false },
    });
    expect(fixture.calls.at(-1)?.text).toBe("ROLLBACK");
  });

  it("rolls back a reused idempotency key with a different question", async () => {
    const input = commandInput();
    const fixture = scriptedPool((text) => {
      if (text.includes("accept_backend_run_command")) {
        throw new Error("DA_COMMAND_IDEMPOTENCY_CONFLICT");
      }
      return undefined;
    });
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    expect(await repository.acceptCommand(authority.capability, input)).toMatchObject({
      ok: false,
      error: { code: "COMMAND_IDEMPOTENCY_CONFLICT", retryable: false },
    });
    expect(fixture.calls.at(-1)?.text).toBe("ROLLBACK");
  });

  it("binds Run reads to app, tenant, environment, object id and principal", async () => {
    const fixture = scriptedPool((text) =>
      text.includes("from runs")
        ? {
            rows: [
              {
                app_id: ids.app,
                tenant_id: ids.tenant,
                environment: "test",
                run_id: ids.run,
                principal_id: ids.principal,
                status: "QUEUED",
                active_fence: "0",
                question: "question",
                created_at: "2026-07-25T00:00:00.000Z",
                updated_at: "2026-07-25T00:00:00.000Z",
              },
            ],
            rowCount: 1,
          }
        : undefined,
    );
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    const result = await repository.getRun(authority.capability, { run_id: ids.run });

    expect(result).toMatchObject({
      ok: true,
      value: {
        app_id: ids.app,
        tenant_id: ids.tenant,
        principal_id: ids.principal,
        active_fence: 0,
      },
    });
    const query = fixture.calls.find(({ text }) => text.includes("from runs"));
    expect(query?.values).toEqual([ids.app, ids.tenant, "test", ids.run, ids.principal]);
    expect(query?.text).toContain("left join lateral");
    expect(query?.text).toContain("candidate.status");
    expect(query?.text).toContain("order by candidate.version desc");
  });

  it("binds artifact existence checks to the owning run principal", async () => {
    const fixture = scriptedPool((text) =>
      text.includes("from artifacts as artifact")
        ? { rows: [{ present: 1 }], rowCount: 1 }
        : undefined,
    );
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);
    const reference = {
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "test",
      run_id: ids.run,
      artifact_id: "00000000-0000-4000-8000-000000000701",
      artifact_type: "QuestionFrame",
      revision: 1,
      content_hash: `sha256:${"a".repeat(64)}`,
    };

    expect(await repository.verifyCommitted(authority.capability, reference)).toEqual({
      ok: true,
      value: true,
    });
    const query = fixture.calls.find(({ text }) => text.includes("from artifacts as artifact"));
    expect(query?.text).toContain("and run.principal_id = $9");
    expect(query?.values.at(-1)).toBe(ids.principal);
  });

  it("commits a valid ExecutionReceipt carrying a non-credential snapshot token", async () => {
    const sqlReference = {
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "test",
      run_id: ids.run,
      artifact_id: "00000000-0000-4000-8000-000000000711",
      artifact_type: "SqlArtifact",
      revision: 1,
      content_hash: `sha256:${"b".repeat(64)}`,
    };
    const validationReference = {
      ...sqlReference,
      artifact_id: "00000000-0000-4000-8000-000000000712",
      artifact_type: "ValidationReceipt",
      content_hash: `sha256:${"c".repeat(64)}`,
    };
    const document = await committedDocument({
      artifact_id: "00000000-0000-4000-8000-000000000713",
      artifact_type: "ExecutionReceipt",
      input_refs: [sqlReference, validationReference],
      payload: {
        artifact_type: "ExecutionReceipt",
        sql_artifact_ref: sqlReference,
        validation_receipt_ref: validationReference,
        datasource_id: "00000000-0000-4000-8000-000000000714",
        schema_version: "schema-1",
        snapshot_token: "snapshot-1",
        watermark: "watermark-1",
        observed_at: "2026-07-25T00:00:00.000Z",
        query_hash: `sha256:${"d".repeat(64)}`,
        replay_state: "REPLAYABLE",
        row_count: 3,
      },
    });
    const fixture = scriptedPool((text) => {
      if (text.includes("lock_owned_run_fence")) {
        return { rows: [{ active_fence: "0" }], rowCount: 1 };
      }
      if (text.includes("select revision, content_hash")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("from artifacts as artifact")) {
        return { rows: [{ present: 1 }], rowCount: 1 };
      }
      if (text.includes("insert into artifacts")) {
        return { rows: [], rowCount: 1 };
      }
      return undefined;
    });
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    expect(
      await repository.commitL2Artifact(authority.capability, document, {
        expected_active_revision: 0,
        worker_fence: 0,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        artifact_type: "ExecutionReceipt",
        content_hash: document.envelope.content_hash,
      },
    });
    const fenceLock = fixture.calls.find(({ text }) => text.includes("lock_owned_run_fence"));
    expect(fenceLock?.values).toEqual([ids.run]);
    expect(fenceLock?.text).not.toContain("from runs");
  });

  it("commits a continuous revision one to revision two ancestry", async () => {
    const artifactId = "00000000-0000-4000-8000-000000000721";
    const revisionOne = await committedDocument({
      artifact_id: artifactId,
      artifact_type: "QuestionFrame",
      payload: {
        artifact_type: "QuestionFrame",
        raw_question: "收入为什么下降？",
        normalized_question: "解释收入下降原因",
        authorized_datasource_ids: ["00000000-0000-4000-8000-000000000722"],
        expected_output: "多步研究报告",
      },
    });
    const parentReference = {
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "test",
      run_id: ids.run,
      artifact_id: artifactId,
      artifact_type: "QuestionFrame",
      revision: 1,
      content_hash: revisionOne.envelope.content_hash,
    };
    const revisionTwo = await committedDocument({
      artifact_id: artifactId,
      artifact_type: "QuestionFrame",
      revision: 2,
      parent_ref: parentReference,
      payload: {
        artifact_type: "QuestionFrame",
        raw_question: "华南区收入为什么下降？",
        normalized_question: "解释华南区收入下降原因",
        authorized_datasource_ids: ["00000000-0000-4000-8000-000000000722"],
        expected_output: "多步研究报告",
      },
    });
    let active: { readonly revision: number; readonly content_hash: string } | null = null;
    const fixture = scriptedPool((text, values) => {
      if (text.includes("lock_owned_run_fence")) {
        return { rows: [{ active_fence: "0" }], rowCount: 1 };
      }
      if (text.includes("select revision, content_hash")) {
        return { rows: active ? [active] : [], rowCount: active ? 1 : 0 };
      }
      if (text.includes("from artifacts as artifact")) {
        return { rows: [{ present: 1 }], rowCount: 1 };
      }
      if (text.includes("insert into artifacts")) {
        active = {
          revision: Number(values[6]),
          content_hash: String(values[7]),
        };
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("update artifacts")) {
        return { rows: [], rowCount: 1 };
      }
      return undefined;
    });
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    expect(
      await repository.commitL2Artifact(authority.capability, revisionOne, {
        expected_active_revision: 0,
        worker_fence: 0,
      }),
    ).toMatchObject({ ok: true, value: { revision: 1 } });
    expect(
      await repository.commitL2Artifact(authority.capability, revisionTwo, {
        expected_active_revision: 1,
        worker_fence: 0,
      }),
    ).toMatchObject({ ok: true, value: { revision: 2 } });
  });
});
