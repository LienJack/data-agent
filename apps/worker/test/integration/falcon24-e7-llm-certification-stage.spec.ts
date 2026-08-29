import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.FALCON24_E7_PROBE_DATABASE_URL;
const modelId = "deepseek-v4-flash";
const appId = "00000000-0000-4000-8000-00000000da01";
const tenantId = "00000000-0000-4000-8000-00000000e124";
const principalId = "00000000-0000-4000-8000-00000000e125";
const deploymentId = "00000000-0000-4000-8000-000000000001";

function chatResponse(content: string) {
  return {
    id: randomUUID(),
    object: "chat.completion",
    created: 1,
    model: modelId,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
  };
}

function streamResponse(): Response {
  const events = [
    {
      id: randomUUID(),
      object: "chat.completion.chunk",
      created: 1,
      model: modelId,
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: "CREDENTIAL_STREAM_OK" },
          finish_reason: null,
        },
      ],
    },
    {
      id: randomUUID(),
      object: "chat.completion.chunk",
      created: 1,
      model: modelId,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    },
  ];
  return new Response(
    `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

function noNetworkDeepSeekTransport() {
  const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
      string,
      unknown
    >;
    switch (fetch.mock.calls.length) {
      case 1:
        return new Response(JSON.stringify(chatResponse("CREDENTIAL_SMOKE_REQUEST_OK")), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      case 2:
        return new Response(
          JSON.stringify(chatResponse(JSON.stringify({ credentialed_smoke: "structured-ok" }))),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      case 3:
        return new Response(
          JSON.stringify({
            ...chatResponse(""),
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call-e7-stage",
                      type: "function",
                      function: {
                        name: "credentialed_smoke_tool",
                        arguments: JSON.stringify({ probe: "tool-ok" }),
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      case 4:
        expect(body).toMatchObject({ stream: true });
        return streamResponse();
      case 5:
        return new Response(
          JSON.stringify({
            error: {
              message: "credentialed-smoke-remote-secret-marker",
              type: "authentication_error",
              code: "invalid_api_key",
            },
          }),
          { status: 401, headers: { "content-type": "application/json" } },
        );
      default:
        throw new Error("Unexpected DeepSeek certification request.");
    }
  });
  return fetch;
}

describe.skipIf(!databaseUrl)("Falcon24 E7 LLM certification stage", () => {
  const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

  afterAll(async () => {
    await pool?.end();
  });

  it("stages one invisible exact DeepSeek certification and replays without provider I/O", async () => {
    if (!databaseUrl || !pool) throw new Error("Probe database URL is required.");
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "falcon24-e7-stage-"));
    const buildIdentityPath = join(temporaryDirectory, "worker-build.json");
    const stageId = randomUUID();
    const stagingId = randomUUID();
    await writeFile(
      buildIdentityPath,
      JSON.stringify({
        schema_version: "runtime-build-identity@1.0.0",
        consumer_role: "worker",
        generation_id: `sha256:${"a".repeat(64)}`,
        build_id: `sha256:${"b".repeat(64)}`,
        built_at: "2026-08-29T00:00:00.000Z",
        git_commit: "c".repeat(40),
        git_dirty: true,
      }),
      "utf8",
    );
    const previousExitCode = process.exitCode;
    const writes: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    const fetch = noNetworkDeepSeekTransport();
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("DATA_AGENT_ALLOW_FALCON24_E7_LLM_CERTIFICATION", "YES");
    vi.stubEnv("DEEPSEEK_API_KEY", "integration-only-credential");
    vi.stubEnv("DATA_AGENT_DATABASE_URL", databaseUrl);
    vi.stubEnv("DATA_AGENT_RUNTIME_BUILD_IDENTITY_FILE", buildIdentityPath);
    vi.stubEnv("FALCON24_AUTHORITY_EPOCH", "E7");
    vi.stubEnv("FALCON24_STAGING_ID", stagingId);
    vi.stubEnv("FALCON24_LLM_EXECUTION_STAGE_ID", stageId);

    try {
      vi.resetModules();
      await import("../../src/evals/falcon24-e7-llm-certification-cli.js");
      expect(fetch).toHaveBeenCalledTimes(5);
      expect(JSON.parse(writes.at(-1) ?? "{}")).toMatchObject({
        terminal: "PASS",
        replayed: false,
        stage_id: stageId,
      });
      const staged = await pool.query<{
        status: string;
        target_authority_epoch: string;
        is_active: boolean;
        run_status: string;
      }>(
        `select stage.status,stage.target_authority_epoch,artifact.is_active,
                run.status as run_status
           from app_data_agent.falcon24_llm_execution_certification_stage stage
           join app_data_agent.artifacts artifact
             on artifact.app_id=stage.app_id and artifact.tenant_id=stage.tenant_id
            and artifact.environment=stage.environment
            and artifact.run_id=stage.certification_run_id
            and artifact.artifact_id=stage.certification_artifact_id
            and artifact.artifact_type='ModelCertificationReceipt'
            and artifact.revision=stage.certification_revision
           join app_data_agent.runs run
             on run.app_id=stage.app_id and run.tenant_id=stage.tenant_id
            and run.environment=stage.environment and run.run_id=stage.certification_run_id
          where stage.stage_id=$1::uuid`,
        [stageId],
      );
      expect(staged.rows).toEqual([
        {
          status: "STAGED",
          target_authority_epoch: "E7",
          is_active: false,
          run_status: "SUCCEEDED",
        },
      ]);
      const material = await pool.query<{ material: Record<string, unknown> }>(
        `select pg_catalog.jsonb_build_object(
                  'schema_version','falcon24-llm-execution-stage-command@1.0.0',
                  'target_authority_epoch',stage.target_authority_epoch,
                  'staging_id',stage.staging_id,
                  'stage_id',stage.stage_id,
                  'idempotency_key',stage.idempotency_key,
                  'proof_document',stage.proof_document,
                  'certification_claims',artifact.document_json,
                  'worker_fence',artifact.worker_fence
                ) as material
           from app_data_agent.falcon24_llm_execution_certification_stage stage
           join app_data_agent.artifacts artifact
             on artifact.app_id=stage.app_id and artifact.tenant_id=stage.tenant_id
            and artifact.environment=stage.environment
            and artifact.run_id=stage.certification_run_id
            and artifact.artifact_id=stage.certification_artifact_id
            and artifact.revision=stage.certification_revision
          where stage.stage_id=$1::uuid`,
        [stageId],
      );
      const commandMaterial = material.rows[0]?.material;
      if (!commandMaterial) throw new Error("Staged command material is missing.");
      const commandHash = await pool.query<{ value: string }>(
        "select app_data_agent.u2_canonical_sha256($1::jsonb) as value",
        [commandMaterial],
      );
      const command = { ...commandMaterial, command_hash: commandHash.rows[0]?.value };
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("set local role data_agent_backend");
        await client.query(
          `select pg_catalog.set_config('data_agent.app_id',$1,true),
                  pg_catalog.set_config('data_agent.tenant_id',$2,true),
                  pg_catalog.set_config('data_agent.environment','local',true),
                  pg_catalog.set_config('data_agent.principal_id',$3,true),
                  pg_catalog.set_config('data_agent.role','owner',true),
                  pg_catalog.set_config('data_agent.deployment_id',$4,true)`,
          [appId, tenantId, principalId, deploymentId],
        );
        const replay = await client.query<{ value: Record<string, unknown> }>(
          "select app_data_agent.stage_falcon24_llm_execution_certification($1::jsonb) as value",
          [command],
        );
        expect(replay.rows[0]?.value).toMatchObject({ stage_id: stageId });
        const profiles = await client.query<{
          value: { profiles: Array<Record<string, unknown>> };
        }>("select app_data_agent.list_provider_execution_profiles() as value");
        const proof = commandMaterial.proof_document as { model_profile_id?: string };
        expect(
          profiles.rows[0]?.value.profiles.find(
            (profile) => profile.model_profile_id === proof.model_profile_id,
          ),
        ).toMatchObject({ selectable: false, readiness: "CERTIFICATION_REQUIRED" });
        await client.query("rollback");
      } finally {
        client.release();
      }

      const conflictingMaterial = {
        ...commandMaterial,
        worker_fence: Number(commandMaterial.worker_fence) + 1,
      };
      const conflictingHash = await pool.query<{ value: string }>(
        "select app_data_agent.u2_canonical_sha256($1::jsonb) as value",
        [conflictingMaterial],
      );
      const conflictClient = await pool.connect();
      try {
        await conflictClient.query("begin");
        await conflictClient.query("set local role data_agent_backend");
        await conflictClient.query(
          `select pg_catalog.set_config('data_agent.app_id',$1,true),
                  pg_catalog.set_config('data_agent.tenant_id',$2,true),
                  pg_catalog.set_config('data_agent.environment','local',true),
                  pg_catalog.set_config('data_agent.principal_id',$3,true),
                  pg_catalog.set_config('data_agent.role','owner',true),
                  pg_catalog.set_config('data_agent.deployment_id',$4,true)`,
          [appId, tenantId, principalId, deploymentId],
        );
        await expect(
          conflictClient.query(
            "select app_data_agent.stage_falcon24_llm_execution_certification($1::jsonb)",
            [
              {
                ...conflictingMaterial,
                command_hash: conflictingHash.rows[0]?.value,
              },
            ],
          ),
        ).rejects.toMatchObject({ code: "23505" });
        await conflictClient.query("rollback").catch(() => undefined);
      } finally {
        conflictClient.release();
      }

      const deniedClient = await pool.connect();
      try {
        await deniedClient.query("begin");
        await deniedClient.query("set local role data_agent_backend");
        await expect(
          deniedClient.query(
            "select count(*) from app_data_agent.falcon24_llm_execution_certification_stage",
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await deniedClient.query("rollback").catch(() => undefined);
      } finally {
        deniedClient.release();
      }

      writes.length = 0;
      vi.resetModules();
      await import("../../src/evals/falcon24-e7-llm-certification-cli.js");
      expect(fetch).toHaveBeenCalledTimes(5);
      expect(JSON.parse(writes.at(-1) ?? "{}")).toMatchObject({
        terminal: "PASS",
        replayed: true,
        stage_id: stageId,
      });

      const rejectMaterial = {
        schema_version: "falcon24-llm-execution-stage-reject@1.0.0",
        stage_id: stageId,
        proof_hash: (commandMaterial.proof_document as { proof_hash: string }).proof_hash,
        reason_code: "INTEGRATION_PROBE_COMPLETE",
      };
      const rejectHash = await pool.query<{ value: string }>(
        "select app_data_agent.u2_canonical_sha256($1::jsonb) as value",
        [rejectMaterial],
      );
      const rejectClient = await pool.connect();
      try {
        await rejectClient.query("begin");
        await rejectClient.query("set local role data_agent_backend");
        await rejectClient.query(
          `select pg_catalog.set_config('data_agent.app_id',$1,true),
                  pg_catalog.set_config('data_agent.tenant_id',$2,true),
                  pg_catalog.set_config('data_agent.environment','local',true),
                  pg_catalog.set_config('data_agent.principal_id',$3,true),
                  pg_catalog.set_config('data_agent.role','owner',true),
                  pg_catalog.set_config('data_agent.deployment_id',$4,true)`,
          [appId, tenantId, principalId, deploymentId],
        );
        const rejectCommand = { ...rejectMaterial, command_hash: rejectHash.rows[0]?.value };
        const rejected = await rejectClient.query<{ value: Record<string, unknown> }>(
          "select app_data_agent.reject_falcon24_llm_execution_certification_stage($1::jsonb) as value",
          [rejectCommand],
        );
        expect(rejected.rows[0]?.value).toMatchObject({
          status: "REJECTED",
          certification_is_active: false,
          rejection_reason_code: "INTEGRATION_PROBE_COMPLETE",
          rejection_command_hash: rejectHash.rows[0]?.value,
        });
        const replayedRejection = await rejectClient.query<{ value: Record<string, unknown> }>(
          "select app_data_agent.reject_falcon24_llm_execution_certification_stage($1::jsonb) as value",
          [rejectCommand],
        );
        expect(replayedRejection.rows[0]?.value).toEqual(rejected.rows[0]?.value);
        await rejectClient.query("commit");
      } finally {
        rejectClient.release();
      }
    } finally {
      process.exitCode = previousExitCode;
      write.mockRestore();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
