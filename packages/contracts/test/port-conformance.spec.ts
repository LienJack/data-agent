import { describe, it } from "vitest";
import {
  createInMemoryPortConformanceHarness,
  PORT_CONFORMANCE_CASES,
} from "../src/testing/index.js";

describe("In-Memory Port Conformance", () => {
  for (const conformanceCase of PORT_CONFORMANCE_CASES) {
    it(conformanceCase.name, () => conformanceCase.run(createInMemoryPortConformanceHarness));
  }
});
