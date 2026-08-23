import "server-only";

import type { DataSourceCredentialRef } from "@data-agent/contracts";
import type { TestConnectionInput, TestConnectionResult } from "./datasource-types";
import {
  publicSemanticGovernanceError,
  redactSemanticGovernanceError,
} from "./semantic-governance-error";

/** Secret 只能存在于 resolver -> connector 的短生命周期调用栈中。 */
export interface ResolvedDataSourceCredential {
  username?: string;
  secretValue: string;
}

/** 由服务端身份边界提供，不能从 datasource 请求体派生。 */
export interface DataSourceSecretAuthorityContext {
  readonly appId: string;
  readonly tenantId: string;
  readonly environment: string;
  readonly principal: string;
}

export interface SecretResolverPort {
  resolve(
    reference: DataSourceCredentialRef,
    authority: DataSourceSecretAuthorityContext,
  ): Promise<ResolvedDataSourceCredential>;
}

export interface DataSourceConnectorPort {
  test(
    input: TestConnectionInput,
    credential: ResolvedDataSourceCredential | undefined,
  ): Promise<TestConnectionResult>;
}

export function unavailableSecretResolver(): SecretResolverPort {
  return {
    async resolve() {
      throw publicSemanticGovernanceError("DATASOURCE_SECRET_PROVIDER_NOT_CONFIGURED");
    },
  };
}

export async function resolveDataSourceCredential(
  input: TestConnectionInput,
  authority: DataSourceSecretAuthorityContext | null,
  resolver: SecretResolverPort,
  connector: DataSourceConnectorPort,
): Promise<TestConnectionResult> {
  try {
    if (input.type === "sqlite" || input.type === "duckdb") {
      return await connector.test(input, undefined);
    }

    if (!input.credentialRef) {
      throw publicSemanticGovernanceError("DATASOURCE_CREDENTIAL_REF_INVALID");
    }

    if (!authority) {
      throw publicSemanticGovernanceError("DATASOURCE_SECRET_PROVIDER_NOT_CONFIGURED");
    }
    if (
      input.credentialRef.app_id !== authority.appId ||
      input.credentialRef.tenant_id !== authority.tenantId ||
      input.credentialRef.environment !== authority.environment
    ) {
      throw publicSemanticGovernanceError("DATASOURCE_CREDENTIAL_REF_INVALID");
    }

    const credential = await resolver.resolve(input.credentialRef, authority);
    return await connector.test(input, credential);
  } catch (error) {
    const redacted = redactSemanticGovernanceError(error);
    if (
      redacted.code === "DATASOURCE_SECRET_PROVIDER_NOT_CONFIGURED" ||
      redacted.code === "DATASOURCE_CREDENTIAL_REF_INVALID"
    ) {
      throw redacted;
    }
    throw publicSemanticGovernanceError("DATASOURCE_CONNECTION_FAILED", true);
  }
}
