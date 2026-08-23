import {
  type ArtifactReference,
  AUTHORITY_ROLE_POLICY_VERSION,
  type AuthoritativeMetamorphicFixtureReceipt,
  type AuthoritativeMetamorphicOracleReceipt,
  type AuthorityIdentity,
  authorityIdentitySchema,
  deepFreeze,
} from "@data-agent/contracts";
import {
  authorizeMetamorphicOracleReceipt,
  createMetamorphicFixtureAuthority,
  createMetamorphicOracleAuthority,
  getAuthoritativeMetamorphicOracleProjection,
  type MetamorphicFixtureAuthority,
  type MetamorphicOracleAuthority,
  type SandboxServerAuthority,
} from "@data-agent/contracts/server";

interface MetamorphicAuthorityStoreAdapter {
  resolveCommitted(reference: ArtifactReference): Promise<unknown | null>;
  verifyCommitted(reference: ArtifactReference): Promise<boolean>;
  verifyExactArtifactRevision(reference: ArtifactReference, artifact: unknown): Promise<boolean>;
}

export interface MetamorphicFixtureAuthorityRegistration extends MetamorphicAuthorityStoreAdapter {
  readonly identity: AuthorityIdentity;
  readonly sandbox_authority: SandboxServerAuthority;
}

export interface MetamorphicOracleVerifierRegistration extends MetamorphicAuthorityStoreAdapter {
  readonly identity: AuthorityIdentity;
  readonly fixture_authority: unknown;
  readonly sandbox_authority: SandboxServerAuthority;
  now(): string;
}

export type MetamorphicRelationVerification = Readonly<{
  relation_kind:
    | "FAN_OUT"
    | "NULL_ANTI_MEMBERSHIP"
    | "HALF_OPEN_ADDITIVE_PARTITION"
    | "SAME_VALUED_DISTINCT_FACT";
  declared_verdict: "PASS" | "FAIL";
  computed_verdict: "PASS" | "FAIL";
}>;

declare const trustedMetamorphicOracleVerificationBrand: unique symbol;

export type TrustedMetamorphicOracleVerification = Readonly<{
  receipt: AuthoritativeMetamorphicOracleReceipt;
  fixture_receipt: AuthoritativeMetamorphicFixtureReceipt;
  fixture_identity: AuthorityIdentity;
  sandbox_identity: AuthorityIdentity;
  verifier_identity: AuthorityIdentity;
  authority_role_policy_version: typeof AUTHORITY_ROLE_POLICY_VERSION;
  relation_verifications: readonly MetamorphicRelationVerification[];
  computed_verdict: "PASS" | "FAIL";
  readonly [trustedMetamorphicOracleVerificationBrand]: true;
}>;

declare const metamorphicFixtureAuthorityBrand: unique symbol;

export type TrustedMetamorphicFixtureAuthority = Readonly<{
  identity: AuthorityIdentity;
  readonly [metamorphicFixtureAuthorityBrand]: true;
}>;

declare const metamorphicOracleVerifierBrand: unique symbol;

export type TrustedMetamorphicOracleVerifier = Readonly<{
  identity: AuthorityIdentity;
  verify(reference: ArtifactReference): Promise<TrustedMetamorphicOracleVerification | null>;
  readonly [metamorphicOracleVerifierBrand]: true;
}>;

const trustedMetamorphicFixtureAuthorities = new WeakSet<object>();
const trustedMetamorphicFixtureAuthoritySources = new WeakMap<object, object>();
const metamorphicFixtureAuthorityTokens = new WeakMap<object, MetamorphicFixtureAuthority>();
const trustedMetamorphicOracleVerifiers = new WeakSet<object>();
const trustedMetamorphicOracleVerifierSources = new WeakMap<object, object>();
const trustedMetamorphicOracleVerifierFixtures = new WeakMap<
  object,
  TrustedMetamorphicFixtureAuthority
>();
const trustedMetamorphicOracleAuthorityTokens = new WeakMap<object, MetamorphicOracleAuthority>();
const trustedMetamorphicOracleVerifications = new WeakSet<object>();

async function verifyMetamorphicOracleReference(
  authority: MetamorphicOracleAuthority,
  registration: MetamorphicOracleVerifierRegistration,
  reference: ArtifactReference,
): Promise<TrustedMetamorphicOracleVerification | null> {
  try {
    const receipt = await authorizeMetamorphicOracleReceipt(reference, authority);
    const computed = getAuthoritativeMetamorphicOracleProjection(receipt);
    const nowEpoch = Date.parse(registration.now());
    if (!computed || !Number.isFinite(nowEpoch) || Date.parse(receipt.evaluated_at) > nowEpoch) {
      return null;
    }
    const verification = deepFreeze({
      receipt,
      fixture_receipt: computed.fixture_receipt,
      fixture_identity: computed.fixture_receipt.issuer,
      sandbox_identity: computed.sandbox_identity,
      verifier_identity: receipt.verifier,
      authority_role_policy_version: AUTHORITY_ROLE_POLICY_VERSION,
      relation_verifications: computed.relation_verifications,
      computed_verdict: computed.computed_verdict,
    }) as unknown as TrustedMetamorphicOracleVerification;
    trustedMetamorphicOracleVerifications.add(verification);
    return verification;
  } catch {
    return null;
  }
}

/**
 * @internal Fixture Authority 只接受完整 Reference 与真实 Sandbox Authority；
 * applicability/Mutation/Selection 算法固定在 contracts kernel 内。
 */
export function registerTrustedMetamorphicFixtureAuthority(
  registration: MetamorphicFixtureAuthorityRegistration,
): TrustedMetamorphicFixtureAuthority {
  const identity = authorityIdentitySchema.safeParse(registration.identity);
  if (
    !identity.success ||
    typeof registration.resolveCommitted !== "function" ||
    typeof registration.verifyCommitted !== "function" ||
    typeof registration.verifyExactArtifactRevision !== "function"
  ) {
    throw new TypeError("TEXT2SQL_METAMORPHIC_FIXTURE_AUTHORITY_INVALID");
  }
  const fixedRegistration: MetamorphicFixtureAuthorityRegistration = {
    identity: deepFreeze(identity.data),
    sandbox_authority: registration.sandbox_authority,
    resolveCommitted: registration.resolveCommitted.bind(registration),
    verifyCommitted: registration.verifyCommitted.bind(registration),
    verifyExactArtifactRevision: registration.verifyExactArtifactRevision.bind(registration),
  };
  const authorityToken = createMetamorphicFixtureAuthority({
    identity: fixedRegistration.identity,
    sandbox_authority: fixedRegistration.sandbox_authority,
    resolveCommitted: fixedRegistration.resolveCommitted,
    verifyCommitted: fixedRegistration.verifyCommitted,
    verifyExactArtifactRevision: fixedRegistration.verifyExactArtifactRevision,
  });
  const authority = Object.freeze({
    identity: deepFreeze(identity.data),
  }) as TrustedMetamorphicFixtureAuthority;
  trustedMetamorphicFixtureAuthorities.add(authority);
  trustedMetamorphicFixtureAuthoritySources.set(authority, registration);
  metamorphicFixtureAuthorityTokens.set(authority, authorityToken);
  return authority;
}

/**
 * @internal Meta Authority 的 resolver、Fixture/Sandbox token 与四类关系算法固定组合；
 * adapter 不能注入 `verify(): true`。
 */
export function registerTrustedMetamorphicOracleVerifier(
  registration: MetamorphicOracleVerifierRegistration,
): TrustedMetamorphicOracleVerifier {
  const identity = authorityIdentitySchema.safeParse(registration.identity);
  const fixtureAuthority = isTrustedMetamorphicFixtureAuthority(registration.fixture_authority)
    ? registration.fixture_authority
    : null;
  const fixtureToken = fixtureAuthority
    ? metamorphicFixtureAuthorityTokens.get(fixtureAuthority)
    : null;
  if (
    !identity.success ||
    !fixtureAuthority ||
    !fixtureToken ||
    trustedMetamorphicFixtureAuthoritySources.get(fixtureAuthority) === registration ||
    typeof registration.resolveCommitted !== "function" ||
    typeof registration.verifyCommitted !== "function" ||
    typeof registration.verifyExactArtifactRevision !== "function" ||
    typeof registration.now !== "function"
  ) {
    throw new TypeError("TEXT2SQL_METAMORPHIC_ORACLE_VERIFIER_INVALID");
  }
  const fixedRegistration: MetamorphicOracleVerifierRegistration = {
    identity: deepFreeze(identity.data),
    fixture_authority: fixtureAuthority,
    sandbox_authority: registration.sandbox_authority,
    resolveCommitted: registration.resolveCommitted.bind(registration),
    verifyCommitted: registration.verifyCommitted.bind(registration),
    verifyExactArtifactRevision: registration.verifyExactArtifactRevision.bind(registration),
    now: registration.now.bind(registration),
  };
  const authorityToken = createMetamorphicOracleAuthority({
    identity: fixedRegistration.identity,
    fixture_authority: fixtureToken,
    sandbox_authority: fixedRegistration.sandbox_authority,
    resolveCommitted: fixedRegistration.resolveCommitted,
    verifyCommitted: fixedRegistration.verifyCommitted,
    verifyExactArtifactRevision: fixedRegistration.verifyExactArtifactRevision,
  });
  const verifier = Object.freeze({
    identity: deepFreeze(identity.data),
    verify: (reference: ArtifactReference) =>
      verifyMetamorphicOracleReference(authorityToken, fixedRegistration, reference),
  }) as TrustedMetamorphicOracleVerifier;
  trustedMetamorphicOracleVerifiers.add(verifier);
  trustedMetamorphicOracleVerifierSources.set(verifier, registration);
  trustedMetamorphicOracleVerifierFixtures.set(verifier, fixtureAuthority);
  trustedMetamorphicOracleAuthorityTokens.set(verifier, authorityToken);
  return verifier;
}

export function isTrustedMetamorphicFixtureAuthority(
  value: unknown,
): value is TrustedMetamorphicFixtureAuthority {
  return (
    typeof value === "object" && value !== null && trustedMetamorphicFixtureAuthorities.has(value)
  );
}

export function trustedMetamorphicFixtureAuthoritySource(value: unknown): object | null {
  return typeof value === "object" && value !== null
    ? (trustedMetamorphicFixtureAuthoritySources.get(value) ?? null)
    : null;
}

export function isTrustedMetamorphicOracleVerifier(
  value: unknown,
): value is TrustedMetamorphicOracleVerifier {
  return (
    typeof value === "object" && value !== null && trustedMetamorphicOracleVerifiers.has(value)
  );
}

export function trustedMetamorphicOracleVerifierSource(value: unknown): object | null {
  return typeof value === "object" && value !== null
    ? (trustedMetamorphicOracleVerifierSources.get(value) ?? null)
    : null;
}

export function trustedMetamorphicOracleVerifierFixtureAuthority(
  value: unknown,
): TrustedMetamorphicFixtureAuthority | null {
  return typeof value === "object" && value !== null
    ? (trustedMetamorphicOracleVerifierFixtures.get(value) ?? null)
    : null;
}

export function trustedMetamorphicOracleAuthorityToken(
  value: unknown,
): MetamorphicOracleAuthority | null {
  return typeof value === "object" && value !== null
    ? (trustedMetamorphicOracleAuthorityTokens.get(value) ?? null)
    : null;
}

export function isTrustedMetamorphicOracleVerification(
  value: unknown,
): value is TrustedMetamorphicOracleVerification {
  return (
    typeof value === "object" && value !== null && trustedMetamorphicOracleVerifications.has(value)
  );
}
