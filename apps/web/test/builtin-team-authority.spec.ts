import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isBuiltinTeamAuthorityNotReady } from "../src/lib/builtin-team-authority";

describe("builtin Team authority readiness", () => {
  it.each(["BUILTIN_TEAM_MODEL_PROFILE_REQUIRED", "BUILTIN_TEAM_PROFILE_SET_STALE"])(
    "treats %s as a recoverable not-ready state",
    (message) => {
      expect(isBuiltinTeamAuthorityNotReady(new TypeError(message))).toBe(true);
    },
  );

  it("does not swallow unrelated authority failures", () => {
    expect(isBuiltinTeamAuthorityNotReady(new TypeError("CAPABILITY_DENIED"))).toBe(false);
    expect(isBuiltinTeamAuthorityNotReady(new Error("BUILTIN_TEAM_MODEL_PROFILE_REQUIRED"))).toBe(
      false,
    );
  });
});
