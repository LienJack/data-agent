import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFalcon24BrowserSubmissionClaim } from "../src/lib/qa-store";

const root = resolve(import.meta.dirname, "../../..");

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("Falcon24 diagnostic control surface", () => {
  it("exposes one non-scoring diagnostic CLI backed by the PostgreSQL authority", () => {
    const packageJson = JSON.parse(source("apps/web/package.json")) as {
      readonly scripts?: Readonly<Record<string, string>>;
    };
    const diagnostic = source("apps/web/src/cli/falcon24-diagnostic.ts");

    expect(packageJson.scripts?.["falcon24:diagnostic:control"]).toContain(
      "src/cli/falcon24-diagnostic.ts",
    );
    expect(diagnostic).toContain("createPostgresFalcon24DiagnosticAuthority");
    expect(diagnostic).toContain("buildFalcon24DiagnosticAttempt");
    expect(diagnostic).toContain("buildFalcon24DiagnosticAttemptV2");
    expect(diagnostic).toContain("submitFalcon24QuestionFromBrowser");
    expect(diagnostic).toContain("runFalcon24BrowserTraceGate");
    expect(diagnostic).toContain("commitUiReceipt");
    expect(diagnostic).toContain("FALCON24_DIAGNOSTIC_OBSERVED_EXECUTION_PATH");
  });

  it("uses a diagnostic-owned Worker cleanup instead of claiming a formal gate slot", () => {
    const workerPackage = JSON.parse(source("apps/worker/package.json")) as {
      readonly scripts?: Readonly<Record<string, string>>;
    };
    const reclamation = source("apps/worker/src/evals/falcon24-diagnostic-reclamation-cli.ts");

    expect(workerPackage.scripts?.["falcon24:diagnostic:reclaim"]).toContain(
      "falcon24-diagnostic-reclamation-cli.ts",
    );
    expect(reclamation).toContain("createPostgresFalcon24DiagnosticAuthority");
    expect(reclamation).toContain("reclaimFalcon24RunSandboxes");
    expect(reclamation).not.toContain("createPostgresFalcon24AcceptanceCampaignAuthority");
    expect(reclamation).not.toContain("createPostgresFalcon24QualificationAuthority");
  });

  it("builds E4 v3 and E5+ v4 manifests from one exact same-epoch PASSED diagnostic", () => {
    const qualification = source("apps/web/src/cli/falcon24-qualification.ts");
    const reclamation = source("apps/worker/src/evals/falcon24-diagnostic-reclamation-cli.ts");

    expect(qualification).toContain("buildFalcon24QualificationManifestV3");
    expect(qualification).toContain("buildFalcon24QualificationManifestV4");
    expect(qualification).toContain("createPostgresFalcon24DiagnosticAuthority");
    expect(qualification).toContain("diagnostic_receipt_ref");
    expect(qualification).toContain("FALCON24_QUALIFICATION_DIAGNOSTIC_PASSED_REQUIRED");
    expect(qualification).toContain("diagnostic.authority_epoch !== authorityEpoch");
    expect(reclamation).toContain("qualificationIdForEpoch(attempt.authority_epoch)");
  });

  it("projects a diagnostic browser claim to deterministic idempotency without a formal fence", () => {
    const question = "最近 12 个完整月的订单收入趋势如何？请按月展示，并生成折线图。";
    const conversationId = "00000000-0000-4000-8000-000000000201";
    const attemptId = "00000000-0000-4000-8000-000000000202";
    const runId = "00000000-0000-4000-8000-000000000203";

    expect(
      parseFalcon24BrowserSubmissionClaim(
        JSON.stringify({
          schema_version: "falcon24-browser-diagnostic-submit-claim@1.0.0",
          question,
          conversation_id: conversationId,
          idempotency_key: "diagnostic-idempotency",
          diagnostic_attempt_id: attemptId,
          run_id: runId,
        }),
        question,
        conversationId,
      ),
    ).toEqual({
      idempotency_key: "diagnostic-idempotency",
      diagnostic_attempt_id: attemptId,
      run_id: runId,
    });
    expect(() =>
      parseFalcon24BrowserSubmissionClaim(
        JSON.stringify({
          schema_version: "falcon24-browser-diagnostic-submit-claim@1.0.0",
          question: "wrong",
          conversation_id: conversationId,
          idempotency_key: "diagnostic-idempotency",
          diagnostic_attempt_id: attemptId,
          run_id: runId,
        }),
        question,
        conversationId,
      ),
    ).toThrow("FALCON24_BROWSER_DIAGNOSTIC_CLAIM_INVALID");
  });
});
