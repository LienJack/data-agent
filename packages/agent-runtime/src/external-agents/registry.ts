import {
  type AppScope,
  appScopeSchema,
  canonicalizeJson,
  deepFreeze,
  immutableIdSchema,
  versionIdentifierSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  type EnabledExternalAgentRegistration,
  type ExternalAgentRegistration,
  type ExternalAgentRegistrationStatus,
  externalAgentRegistrationSchema,
} from "./contracts.js";
import { ExternalAgentRuntimeError } from "./errors.js";

const externalAgentProfileLookupSchema = z.strictObject({
  scope: appScopeSchema,
  profile_id: immutableIdSchema,
  profile_version: versionIdentifierSchema,
});

type ExternalAgentProfileLookup = z.infer<typeof externalAgentProfileLookupSchema>;

function registrationKey(input: ExternalAgentProfileLookup): string {
  return canonicalizeJson([
    input.scope.environment,
    input.scope.app_id,
    input.scope.tenant_id,
    input.profile_id,
    input.profile_version,
  ]);
}

function parseRegistration(input: unknown): ExternalAgentRegistration {
  const parsed = externalAgentRegistrationSchema.safeParse(input);
  if (!parsed.success) {
    throw new ExternalAgentRuntimeError(
      "EXTERNAL_AGENT_REGISTRATION_INVALID",
      parsed.error.issues[0]?.message ?? "External Agent 注册项不符合服务端契约。",
    );
  }
  return deepFreeze(parsed.data);
}

export class ServerExternalAgentRegistry {
  readonly #registrations = new Map<string, ExternalAgentRegistration>();

  register(input: unknown): void {
    const registration = parseRegistration(input);
    const key = registrationKey({
      scope: registration.profile.scope,
      profile_id: registration.profile.profile_id,
      profile_version: registration.profile.profile_version,
    });
    if (this.#registrations.has(key)) {
      throw new ExternalAgentRuntimeError(
        "EXTERNAL_AGENT_PROFILE_ALREADY_REGISTERED",
        "同一 Scope/Profile/Version 的 External Agent 已登记。",
      );
    }
    this.#registrations.set(key, registration);
  }

  readonly resolveProfile = async (input: {
    readonly scope: AppScope;
    readonly profile_id: string;
    readonly profile_version: string;
  }): Promise<unknown | null> => {
    const lookup = externalAgentProfileLookupSchema.safeParse(input);
    if (!lookup.success) {
      return null;
    }
    const registration = this.#registrations.get(registrationKey(lookup.data));
    return registration?.enabled === true ? registration.profile : null;
  };

  resolveEnabledRegistration(input: unknown): EnabledExternalAgentRegistration | null {
    const lookup = externalAgentProfileLookupSchema.safeParse(input);
    if (!lookup.success) {
      return null;
    }
    const registration = this.#registrations.get(registrationKey(lookup.data));
    return registration?.enabled === true ? registration : null;
  }

  list(): readonly ExternalAgentRegistrationStatus[] {
    return Object.freeze(
      [...this.#registrations.values()].map((registration) =>
        Object.freeze({
          profile_id: registration.profile.profile_id,
          profile_version: registration.profile.profile_version,
          scope: registration.profile.scope,
          adapter: registration.profile.adapter,
          enabled: registration.enabled,
          has_process_host: registration.enabled,
        }),
      ),
    );
  }
}
