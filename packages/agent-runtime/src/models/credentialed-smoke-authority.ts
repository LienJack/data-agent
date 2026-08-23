import type { ProviderCredentialedSmoke } from "./certification.js";

const authorizedProviderCredentialedSmokes = new WeakSet<ProviderCredentialedSmoke>();

/**
 * Package-internal authority seam. This module is deliberately not re-exported
 * from the package root.
 */
export function authorizeLiveProviderCredentialedSmoke(
  smoke: ProviderCredentialedSmoke,
): ProviderCredentialedSmoke {
  authorizedProviderCredentialedSmokes.add(smoke);
  return smoke;
}

export function isAuthorizedProviderCredentialedSmoke(smoke: ProviderCredentialedSmoke): boolean {
  return authorizedProviderCredentialedSmokes.has(smoke);
}
