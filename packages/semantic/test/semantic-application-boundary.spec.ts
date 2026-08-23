import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSemanticCandidateService,
  type SemanticCandidateServiceDependencies,
} from "../src/application/candidate.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

describe("Semantic application boundaries", () => {
  it("exposes review submission but no publish or rollback capability to AI Candidate", () => {
    const service = createSemanticCandidateService({} as SemanticCandidateServiceDependencies);

    expect(Object.keys(service).sort()).toEqual(["compile", "get", "submit"]);
    expect("publish" in service).toBe(false);
    expect("rollback" in service).toBe(false);
  });

  it("keeps production semantic routes on the single Workspace composition root", () => {
    const webRoot = resolve(repositoryRoot, "apps/web/src");
    const composition = readFileSync(resolve(webRoot, "lib/workspace-semantic-runtime.ts"), "utf8");
    const inductionRoute = readFileSync(
      resolve(webRoot, "app/api/workspaces/[workspaceId]/semantic/induction-jobs/route.ts"),
      "utf8",
    );

    expect(composition.match(/export async function getWorkspaceSemanticRuntime/g)).toHaveLength(1);
    expect(inductionRoute).toContain("getWorkspaceSemanticRuntime");
    expect(inductionRoute).not.toContain("getSemanticInductionRegistry");
    expect(existsSync(resolve(webRoot, "app/api/semantic/governance/inbox/route.ts"))).toBe(false);
    expect(existsSync(resolve(webRoot, "lib/semantic-governance-service.ts"))).toBe(false);
    expect(existsSync(resolve(webRoot, "lib/semantic-candidate-service.ts"))).toBe(false);
    expect(existsSync(resolve(webRoot, "lib/semantic-explorer-service.ts"))).toBe(false);
    expect(existsSync(resolve(webRoot, "lib/semantic-studio-service.ts"))).toBe(false);
    expect(existsSync(resolve(webRoot, "lib/semantic-studio-runtime.ts"))).toBe(false);
    expect(existsSync(resolve(webRoot, "lib/semantic-candidate-save-runtime.ts"))).toBe(false);
  });

  it("keeps production semantic jobs on the single job composition root", () => {
    for (const relativePath of [
      "apps/worker/src/run-worker-cli.ts",
      "apps/worker/src/semantic/authoring-worker-cli.ts",
      "apps/worker/src/semantic/relationship-indexer-cli.ts",
    ]) {
      expect(readFileSync(resolve(repositoryRoot, relativePath), "utf8")).toContain(
        "createWorkerSemanticJobComposition",
      );
    }
  });
});
