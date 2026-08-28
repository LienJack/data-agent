import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const repositoryRoot = new URL("../../../", import.meta.url).pathname;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

let buildFalcon24SuccessorChangeSet: typeof import("../src/lib/falcon24-successor-change-set.js").buildFalcon24SuccessorChangeSet;
let falcon24SuccessorOperationId: typeof import("../src/lib/falcon24-successor-change-set.js").falcon24SuccessorOperationId;

beforeAll(async () => {
  ({ buildFalcon24SuccessorChangeSet, falcon24SuccessorOperationId } = await import(
    "../src/lib/falcon24-successor-change-set.js"
  ));
});

describe("Falcon24 fixed successor ChangeSet builder", () => {
  it("executes the fixed repository builder and verifies its frozen closure", async () => {
    const prepared = await buildFalcon24SuccessorChangeSet({
      repository_root: repositoryRoot,
      scope: {
        app_id: "00000000-0000-4000-8000-00000000da01",
        tenant_id: "00000000-0000-4000-8000-00000000a192",
        environment: "test",
        semantic_domain: "falcon24",
      },
      base_release: {
        release_id: "00000000-0000-4000-8000-000000007191",
        generation: 1,
        release_hash: hash("1"),
      },
      expected_datasource_id: "37653002-af62-53c9-bf21-519468aa39ab",
      revision: 1,
    });

    expect(prepared.change_set).toMatchObject({
      lifecycle_state: "REVIEW_FROZEN",
      validation: { outcome: "PASS" },
      base_release: { generation: 1, release_hash: hash("1") },
    });
    expect(prepared.assertion_count).toBeGreaterThan(1);
    expect(prepared.competency_case_count).toBe(5);
  }, 30_000);

  it("derives stable version-five operation identifiers", () => {
    const first = falcon24SuccessorOperationId("falcon24:review:one");
    expect(first).toBe(falcon24SuccessorOperationId("falcon24:review:one"));
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  });
});
