import { loadRuntimeBuildIdentity, type RuntimeBuildIdentity } from "@data-agent/contracts/server";

let runtimeBuildIdentity: RuntimeBuildIdentity | undefined;

export function initializeWebRuntimeBuildIdentity(
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeBuildIdentity {
  runtimeBuildIdentity = loadRuntimeBuildIdentity({ expectedRole: "web", environment });
  return runtimeBuildIdentity;
}

export function getWebRuntimeBuildIdentity(): RuntimeBuildIdentity {
  return runtimeBuildIdentity ?? initializeWebRuntimeBuildIdentity();
}

export function setWebRuntimeBuildIdentityForTest(identity: RuntimeBuildIdentity): void {
  runtimeBuildIdentity = loadRuntimeBuildIdentity({
    expectedRole: "web",
    testIdentity: identity,
  });
}

export function resetWebRuntimeBuildIdentityForTest(): void {
  runtimeBuildIdentity = undefined;
}
