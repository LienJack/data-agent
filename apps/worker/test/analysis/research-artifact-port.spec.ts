import {
  type AnalysisProgramPayload,
  type ArtifactReference,
  analysisProgramPayloadSchema,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { createResearchAnalysisArtifactPort } from "../../src/analysis/research-artifact-port.js";
import { DEFAULT_ANALYSIS_SKILL_CATALOG } from "../../src/analysis/skill-catalog.js";

const id = (suffix: number) => `33000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const runId = id(3);

function reference(
  artifact_type: ArtifactReference["artifact_type"],
  suffix: number,
  content_hash = hash(String(suffix % 10)),
): ArtifactReference {
  return {
    artifact_id: id(suffix),
    artifact_type,
    ...scope,
    run_id: runId,
    revision: 1,
    content_hash,
  };
}

function program(): AnalysisProgramPayload {
  const descriptor = DEFAULT_ANALYSIS_SKILL_CATALOG.resolve("open-python-analysis@1");
  return analysisProgramPayloadSchema.parse({
    artifact_type: "AnalysisProgram",
    protocol_version: "analysis-program@1.0.0",
    brief_ref: reference("ResearchBrief", 10),
    analysis_context_hash: hash("a"),
    semantic_context_package_hash: hash("b"),
    nodes: [
      {
        node_id: "falcon24-business-review-18m",
        skill_id: "open-python-analysis@1",
        metric_refs: [
          { container_ref: reference("SemanticRelease", 11), node_id: "order_revenue" },
        ],
        dimension_refs: [],
        time_window: {
          start: "2023-05-01T00:00:00.000Z",
          end: "2024-11-01T00:00:00.000Z",
          timezone: "Asia/Shanghai",
          semantics: "HALF_OPEN",
        },
        comparison_window: null,
        parameters: {},
        execution_mode: "MODEL_GENERATED",
        output_contract: descriptor.output_contract,
        dependency_node_ids: [],
        activation_rule: { kind: "ALWAYS" },
        criticality: "CRITICAL",
      },
    ],
    budget: {
      max_steps: 1,
      max_sql_executions: 1,
      max_sandbox_executions: 1,
      max_series_rows: 5_000,
      max_group_rows: 5_000,
      max_elapsed_ms: 120_000,
    },
    compiler_kind: "MODEL_CANDIDATE_HOST_VERIFIED",
    compiler_version: "falcon24-agent-analysis-compiler@1.0.0",
    program_hash: hash("c"),
  });
}

const lease = {
  scope,
  principal_id: id(4),
  outbox_id: id(5),
  run_id: runId,
  command_id: id(6),
  command_kind: "START_L2_RESEARCH",
  attempt_id: id(7),
  attempt_no: 1,
  delivery_attempt_no: 1,
  lease_duration_ms: 120_000,
  worker_id: "analysis-worker",
  lease_token: 1,
  worker_fence: 2,
  expires_at: "2026-08-24T00:02:00.000Z",
  payload: {},
} as const;

describe("research analysis artifact port", () => {
  it("seals revision-one L2 candidates without confusing payload dependencies for revision parents", async () => {
    const commands: Array<Record<string, unknown>> = [];
    const commitCurrent = vi.fn(async (_capability: unknown, command: Record<string, unknown>) => {
      commands.push(command);
      const candidate = command.candidate as { envelope: ArtifactReference };
      return {
        protocol_version: "u6-db-result@1.0.0" as const,
        ok: true as const,
        value: { reference: candidate.envelope, created: commands.length === 1 },
      };
    });
    const artifacts = createResearchAnalysisArtifactPort({
      capabilities: {
        forArtifactType: (artifactType) => ({ authority: artifactType }) as never,
        forDomain: (domain) => ({ authority: domain }) as never,
      },
      authority: {
        commitCurrent: commitCurrent as never,
        readHistorical: vi.fn(async () => ({
          protocol_version: "u6-db-result@1.0.0" as const,
          ok: true as const,
          value: null,
        })),
        commitAnalysisSystem: vi.fn(),
      },
      now: () => new Date("2026-08-24T00:00:00.000Z"),
    });
    const payload = program();
    const input = {
      lease,
      principal_id: lease.principal_id,
      idempotency_key: "analysis-program:falcon24",
      payload,
    } as const;
    const first = await artifacts.commitL2(input);
    const replay = await artifacts.commitL2(input);

    expect(first).toEqual(replay);
    expect(commands).toHaveLength(2);
    expect(commands[0]).toMatchObject({
      attempt_id: lease.attempt_id,
      worker_fence: 2,
      expected_parent_ref: null,
      candidate: {
        envelope: {
          artifact_type: "AnalysisProgram",
          parent_ref: null,
          producer: { kind: "deterministic", id: "analysis-program-executor@1" },
          status: "CANDIDATE",
        },
      },
    });
    expect(commands[1]?.expected_parent_ref).toBeNull();
  });

  it("commits system artifacts through the fenced PostgreSQL authority", async () => {
    const systemRef = reference("SandboxProgram", 20);
    const commitAnalysisSystem = vi.fn(async () => ({
      ok: true as const,
      created: true,
      reference: systemRef,
    }));
    const artifacts = createResearchAnalysisArtifactPort({
      capabilities: {
        forArtifactType: (artifactType) => ({ authority: artifactType }) as never,
        forDomain: (domain) => ({ authority: domain }) as never,
      },
      authority: {
        commitCurrent: vi.fn() as never,
        readHistorical: vi.fn() as never,
        commitAnalysisSystem,
      },
    });
    await expect(
      artifacts.commitSystem({
        lease,
        principal_id: lease.principal_id,
        idempotency_key: "analysis-program:falcon24:node",
        reference: systemRef,
        payload: { artifact_type: "SandboxProgram" },
        content: null,
      }),
    ).resolves.toEqual(systemRef);
    expect(commitAnalysisSystem).toHaveBeenCalledWith(
      { authority: "SandboxProgram" },
      expect.objectContaining({
        attempt_id: lease.attempt_id,
        worker_fence: lease.worker_fence,
        reference: systemRef,
      }),
      null,
    );
  });
});
