import "server-only";

import type { ModelProviderConnection } from "@data-agent/contracts";
import { ensureRootEnvironmentLoaded } from "./root-env";

export class ModelProviderCredentialError extends Error {
  readonly code = "MODEL_CREDENTIAL_RESOLVER_UNAVAILABLE";
  readonly status = 503;

  constructor(readonly locator: string) {
    super("供应商凭据尚未由服务端 Secret Authority 注入。");
    this.name = "ModelProviderCredentialError";
  }
}

export function modelProviderCredentialLocator(connectionId: string): string {
  return `MODEL_PROVIDER_SECRET_${connectionId.replaceAll("-", "").toUpperCase()}`;
}

export function resolveManualProviderCredential(connection: ModelProviderConnection): string {
  ensureRootEnvironmentLoaded();
  const locator = modelProviderCredentialLocator(connection.provider_connection_id);
  const credential = process.env[locator]?.trim();
  if (!credential) throw new ModelProviderCredentialError(locator);
  return credential;
}
