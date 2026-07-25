import type { ProviderCredentialedSmoke } from "../../src/models/certification.js";
import { authorizeLiveProviderCredentialedSmoke } from "../../src/models/credentialed-smoke-authority.js";

/**
 * 仅存在于测试源码树，不进入 package build、files 或 exports。
 */
export function authorizeProviderCredentialedSmokeForTesting(
  smoke: ProviderCredentialedSmoke,
): ProviderCredentialedSmoke {
  return authorizeLiveProviderCredentialedSmoke(smoke);
}
