import { describe, expect, it } from "vitest";
import { buildFalcon24SemanticChangeSet } from "../../src/evals/falcon24-semantic-change-set.js";

const id = (suffix: number) => `60000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

describe("Falcon24 governed semantic change set", () => {
  it("deterministically freezes all physical bindings and five competency cases for human review", async () => {
    const input = {
      scope: {
        app_id: id(1),
        tenant_id: id(2),
        environment: "test" as const,
        semantic_domain: "falcon24",
      },
      base_release: { release_id: id(3), generation: 1, release_hash: hash("a") },
    };
    const [first, replay] = await Promise.all([
      buildFalcon24SemanticChangeSet(input),
      buildFalcon24SemanticChangeSet(input),
    ]);
    expect(first.change_set.lifecycle_state).toBe("REVIEW_FROZEN");
    expect(first.change_set.validation).toMatchObject({
      outcome: "PASS",
      evidence_closed: true,
      formula_cycle_free: true,
      grain_join_time_valid: true,
      policy_quality_valid: true,
      competency_cases_passed: true,
    });
    expect(first.competency_case_count).toBe(5);
    expect(first.change_set.competency_results).toHaveLength(5);
    expect(first.change_set.competency_results.every(({ verdict }) => verdict === "PASS")).toBe(
      true,
    );
    expect(
      first.change_set.assertions.filter(({ target_kind }) => target_kind === "PHYSICAL_BINDING"),
    ).toHaveLength(79);
    expect(
      first.change_set.assertions.filter(({ target_kind }) => target_kind === "RELATIONSHIP"),
    ).toHaveLength(8);
    expect(
      first.change_set.assertions.filter(({ target_kind }) => target_kind === "QUALITY_CONSTRAINT"),
    ).toHaveLength(5);
    expect(first.change_set.change_set_hash).toBe(replay.change_set.change_set_hash);
    expect(first.blueprint_hash).toBe(replay.blueprint_hash);
  });

  it("rejects a non-Falcon semantic domain before compiling candidates", async () => {
    await expect(
      buildFalcon24SemanticChangeSet({
        scope: {
          app_id: id(1),
          tenant_id: id(2),
          environment: "test",
          semantic_domain: "ecommerce",
        },
        base_release: { release_id: id(3), generation: 1, release_hash: hash("a") },
      }),
    ).rejects.toThrow("FALCON24_SEMANTIC_DOMAIN_INVALID");
  });
});
