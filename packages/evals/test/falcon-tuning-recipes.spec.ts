import type { SealedFalconCase } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  compileFalconTuningRecipe,
  normalizeFalconPostgresIdentifiers,
} from "../src/test-center/falcon-tuning-recipes.js";

function sealed(registry: "TUNING" | "LOCAL_HOLDOUT"): SealedFalconCase {
  return {
    public_case: {
      case_id: "30000000-0000-4000-8000-000000000001",
      suite_id: "falcon",
      suite_version: "1.0.0",
      dataset_version: "falcon-fixed-8ff29caa-postgres-v1",
      ordinal: 1,
      database_id: "falcon_db_14",
      question: "fixture",
      evidence: null,
      difficulty: "simple",
      capabilities: ["TEXT_TO_SQL"],
      registry,
      runnable: true,
      status_reason: null,
      schema: [],
      public_case_hash: `sha256:${"1".repeat(64)}`,
    },
    expected_results: [{ columns: ["Product_ID"], rows: [[1]], ordered: false }],
    source_gold_sql: [
      "select Product_ID as `product_id` from toy_products where strftime('%Y', Date)='2018'",
    ],
    sealed_case_hash: `sha256:${"2".repeat(64)}`,
  };
}

describe("Falcon evaluator-only tuning recipes", () => {
  it("translates public TUNING SQL without exposing a sealed result", () => {
    expect(compileFalconTuningRecipe(sealed("TUNING"))).toBe(
      `select "Product_ID" as "product_id" from toy_products where to_char(("Date")::date, 'YYYY')='2018'`,
    );
  });

  it("rejects Local Holdout even when source SQL is present", () => {
    expect(() => compileFalconTuningRecipe(sealed("LOCAL_HOLDOUT"))).toThrow(
      "FALCON_TUNING_RECIPE_REGISTRY_DENIED",
    );
  });

  it("restores PostgreSQL case-sensitive physical identifiers", () => {
    const fixture = sealed("TUNING");
    fixture.public_case.database_id = "falcon_db_16";
    fixture.source_gold_sql = [
      "select m.studentid, m.markobtained from school_marks m where m.studentid = 1",
    ];
    expect(compileFalconTuningRecipe(fixture, undefined, ["StudentID", "MarkObtained"])).toBe(
      'select m."StudentID", m."MarkObtained" from school_marks m where m."StudentID" = 1',
    );
  });

  it("normalizes model SQL without changing aliases or Chinese labels", () => {
    expect(
      normalizeFalconPostgresIdentifiers(
        "select t.cust_id as 客户ID from transactions t order by t.transaction_date",
        ["Cust_ID", "Transaction_Date"],
      ),
    ).toBe('select t."Cust_ID" as 客户ID from transactions t order by t."Transaction_Date"');
  });
});
