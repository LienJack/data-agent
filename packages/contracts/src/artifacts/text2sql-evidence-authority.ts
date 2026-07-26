import { canonicalizeJson, deepFreeze } from "../common/index.js";
import {
  type AuthoritativeSandboxExecutionIdentity,
  type AuthoritativeSandboxExecutionReceipt,
  type AuthoritativeSandboxResult,
  authorizeSandboxExecutionReceipt,
  authorizeSandboxResult,
  getAuthoritativeSandboxExecutionIdentity,
  isAuthoritativeSandboxExecutionIdentity,
  isAuthoritativeSandboxExecutionReceipt,
  isAuthoritativeSandboxResult,
  type SandboxServerAuthority,
} from "../ports/sandbox.js";
import {
  type ArtifactReference,
  artifactReferenceFor,
  artifactReferenceIdentity,
} from "./envelope.js";
import {
  AUTHORITY_ROLE_POLICY_VERSION,
  type AuthorityIdentity,
  authorityIdentitySchema,
  computeFixtureMutationRecordHash,
  computeMetamorphicFixtureEvidenceHash,
  computeMetamorphicFixtureReceiptHash,
  computeMetamorphicOracleEvidenceHash,
  computeMetamorphicOracleReceiptHash,
  computeMetamorphicRelationSampleHash,
  computeResultOracleEvidenceHash,
  computeResultOracleReceiptHash,
  type FixtureMutationRecord,
  fixtureMutationRecordSchema,
  type MetamorphicSandboxEvidenceRef,
  metamorphicAuthorityRolePolicySchema,
  metamorphicFixtureReceiptSchema,
  metamorphicOracleReceiptSchema,
  resultOracleReceiptSchema,
} from "./text2sql-evidence.js";
import {
  type AuthoritativeMetamorphicFixtureReceipt,
  type AuthoritativeMetamorphicOracleReceipt,
  type AuthoritativeResultOracleReceipt,
  isAuthoritativeMetamorphicOracleReceipt,
  markAuthoritativeMetamorphicFixtureReceipt,
  markAuthoritativeMetamorphicOracleReceipt,
  markAuthoritativeResultOracleReceipt,
} from "./text2sql-evidence-brands.js";
import {
  type MetamorphicKernelRelationVerification,
  verifyMetamorphicFixtureKernel,
  verifyMetamorphicOracleKernel,
  verifyResultOracleKernel,
} from "./text2sql-metamorphic-kernel.js";

type ReceiptAuthorityStore = Readonly<{
  identity: AuthorityIdentity;
  resolveCommitted(reference: ArtifactReference): Promise<unknown | null>;
  verifyCommitted(reference: ArtifactReference): Promise<boolean>;
  verifyExactArtifactRevision(reference: ArtifactReference, artifact: unknown): Promise<boolean>;
}>;

export type AuthoritativeMetamorphicSandboxEvidence = Readonly<{
  receipt: AuthoritativeSandboxExecutionReceipt;
  result: AuthoritativeSandboxResult;
  execution_identity: AuthoritativeSandboxExecutionIdentity;
}>;

export type MetamorphicFixtureMutationEvidence = Readonly<{
  reference: ArtifactReference;
  record: FixtureMutationRecord;
}>;

export interface MetamorphicFixtureAuthorityOptions extends ReceiptAuthorityStore {
  readonly sandbox_authority: SandboxServerAuthority;
}

declare const metamorphicFixtureAuthorityBrand: unique symbol;
export type MetamorphicFixtureAuthority = Readonly<{
  readonly [metamorphicFixtureAuthorityBrand]: true;
}>;

export interface MetamorphicOracleAuthorityOptions extends ReceiptAuthorityStore {
  readonly fixture_authority: MetamorphicFixtureAuthority;
  readonly sandbox_authority: SandboxServerAuthority;
}

declare const metamorphicOracleAuthorityBrand: unique symbol;
export type MetamorphicOracleAuthority = Readonly<{
  readonly [metamorphicOracleAuthorityBrand]: true;
}>;

export interface ResultOracleReceiptAuthorityOptions extends ReceiptAuthorityStore {
  readonly metamorphic_authority: MetamorphicOracleAuthority;
}

declare const resultOracleReceiptAuthorityBrand: unique symbol;
export type ResultOracleReceiptAuthority = Readonly<{
  readonly [resultOracleReceiptAuthorityBrand]: true;
}>;

export class MetamorphicEvidenceAuthorityError extends Error {
  override readonly name = "MetamorphicEvidenceAuthorityError";
  readonly code = "TEXT2SQL_METAMORPHIC_EVIDENCE_NOT_AUTHORITATIVE";
}

const fixtureAuthorities = new WeakMap<object, MetamorphicFixtureAuthorityOptions>();
const oracleAuthorities = new WeakMap<object, MetamorphicOracleAuthorityOptions>();
const resultAuthorities = new WeakMap<object, ResultOracleReceiptAuthorityOptions>();
const authoritativeOracleReceiptAuthorities = new WeakMap<object, MetamorphicOracleAuthority>();
const fixtureReceiptClosures = new WeakMap<
  object,
  Readonly<{
    sandbox_identity: AuthoritativeSandboxExecutionIdentity;
    selection_probes: readonly AuthoritativeMetamorphicSandboxEvidence[];
  }>
>();
const oracleReceiptClosures = new WeakMap<
  object,
  Readonly<{
    fixture: AuthoritativeMetamorphicFixtureReceipt;
    sandbox_identity: AuthoritativeSandboxExecutionIdentity;
    relation_verifications: readonly MetamorphicKernelRelationVerification[];
    computed_verdict: "PASS" | "FAIL";
  }>
>();

function storeCallbacks(registration: ReceiptAuthorityStore): readonly unknown[] {
  return [
    registration.resolveCommitted,
    registration.verifyCommitted,
    registration.verifyExactArtifactRevision,
  ];
}

function parseRegistrationIdentity(registration: ReceiptAuthorityStore): AuthorityIdentity {
  if (storeCallbacks(registration).some((callback) => typeof callback !== "function")) {
    throw new TypeError("Metamorphic Receipt Authority 必须提供完整持久化回调。");
  }
  return authorityIdentitySchema.parse(registration.identity);
}

function freezeStore(
  registration: ReceiptAuthorityStore,
  identity: AuthorityIdentity,
): ReceiptAuthorityStore {
  return Object.freeze({
    identity: deepFreeze(identity),
    resolveCommitted: registration.resolveCommitted.bind(registration),
    verifyCommitted: registration.verifyCommitted.bind(registration),
    verifyExactArtifactRevision: registration.verifyExactArtifactRevision.bind(registration),
  });
}

export function createMetamorphicFixtureAuthority(
  registration: MetamorphicFixtureAuthorityOptions,
): MetamorphicFixtureAuthority {
  const identity = parseRegistrationIdentity(registration);
  if (
    typeof registration.sandbox_authority !== "object" ||
    registration.sandbox_authority === null
  ) {
    throw new TypeError("Metamorphic Fixture Authority 缺少 Sandbox Authority。");
  }
  const authority = Object.freeze(Object.create(null)) as MetamorphicFixtureAuthority;
  fixtureAuthorities.set(
    authority,
    Object.freeze({
      ...freezeStore(registration, identity),
      sandbox_authority: registration.sandbox_authority,
    }),
  );
  return authority;
}

export function createMetamorphicOracleAuthority(
  registration: MetamorphicOracleAuthorityOptions,
): MetamorphicOracleAuthority {
  const identity = parseRegistrationIdentity(registration);
  if (
    !fixtureAuthorities.has(registration.fixture_authority) ||
    typeof registration.sandbox_authority !== "object" ||
    registration.sandbox_authority === null
  ) {
    throw new TypeError("Metamorphic Oracle Authority 缺少 Fixture/Sandbox Authority。");
  }
  const authority = Object.freeze(Object.create(null)) as MetamorphicOracleAuthority;
  oracleAuthorities.set(
    authority,
    Object.freeze({
      ...freezeStore(registration, identity),
      fixture_authority: registration.fixture_authority,
      sandbox_authority: registration.sandbox_authority,
    }),
  );
  return authority;
}

export function createResultOracleReceiptAuthority(
  registration: ResultOracleReceiptAuthorityOptions,
): ResultOracleReceiptAuthority {
  const identity = parseRegistrationIdentity(registration);
  if (!oracleAuthorities.has(registration.metamorphic_authority)) {
    throw new TypeError("Result Oracle Receipt Authority 缺少 Metamorphic Authority。");
  }
  const authority = Object.freeze(Object.create(null)) as ResultOracleReceiptAuthority;
  resultAuthorities.set(
    authority,
    Object.freeze({
      ...freezeStore(registration, identity),
      metamorphic_authority: registration.metamorphic_authority,
    }),
  );
  return authority;
}

function sameReference(left: ArtifactReference, right: ArtifactReference): boolean {
  return artifactReferenceIdentity(left) === artifactReferenceIdentity(right);
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function sameScopeAndRun(left: ArtifactReference, right: ArtifactReference): boolean {
  return (
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment &&
    left.run_id === right.run_id
  );
}

async function resolveAuthoritativeSandboxEvidence(
  binding: MetamorphicSandboxEvidenceRef,
  authority: SandboxServerAuthority,
): Promise<AuthoritativeMetamorphicSandboxEvidence> {
  const [receipt, result] = await Promise.all([
    authorizeSandboxExecutionReceipt(binding.sandbox_execution_receipt_ref, authority),
    authorizeSandboxResult(binding.result_artifact_ref, authority),
  ]);
  const receiptIdentity = getAuthoritativeSandboxExecutionIdentity(receipt);
  const resultIdentity = getAuthoritativeSandboxExecutionIdentity(result);
  if (
    !isAuthoritativeSandboxExecutionReceipt(receipt) ||
    !isAuthoritativeSandboxResult(result) ||
    !receiptIdentity ||
    !resultIdentity ||
    !isAuthoritativeSandboxExecutionIdentity(receiptIdentity) ||
    receiptIdentity !== resultIdentity ||
    !sameReference(receipt.result_artifact_ref, result.result_ref) ||
    receipt.execution_id !== result.execution_id
  ) {
    throw new MetamorphicEvidenceAuthorityError(
      "Metamorphic Sandbox Evidence 必须由同一稳定 Sandbox Identity 授权。",
    );
  }
  return deepFreeze({
    receipt,
    result,
    execution_identity: receiptIdentity,
  });
}

function ensureSameSandboxIdentity(
  evidence: readonly AuthoritativeMetamorphicSandboxEvidence[],
): AuthoritativeSandboxExecutionIdentity {
  const identity = evidence[0]?.execution_identity;
  if (!identity || evidence.some(({ execution_identity }) => execution_identity !== identity)) {
    throw new MetamorphicEvidenceAuthorityError(
      "Metamorphic Baseline、Probe 与 Follow-up 必须由同一 Sandbox Execution Authority 签发。",
    );
  }
  return identity;
}

export async function authorizeMetamorphicFixtureReceipt(
  referenceInput: unknown,
  authority: MetamorphicFixtureAuthority,
): Promise<AuthoritativeMetamorphicFixtureReceipt> {
  const registration = fixtureAuthorities.get(authority);
  const reference = artifactReferenceFor("MetamorphicFixtureReceipt").safeParse(referenceInput);
  if (!registration || !reference.success) {
    throw new MetamorphicEvidenceAuthorityError(
      "MetamorphicFixtureReceipt 必须通过已注册 Authority 的完整 Reference 授权。",
    );
  }
  const parsed = metamorphicFixtureReceiptSchema.safeParse(
    await registration.resolveCommitted(reference.data),
  );
  if (
    !parsed.success ||
    !sameReference(parsed.data.receipt_ref, reference.data) ||
    !sameJson(parsed.data.issuer, registration.identity) ||
    parsed.data.issuer_role !== "FIXTURE_MUTATION" ||
    parsed.data.authority_role_policy_version !== AUTHORITY_ROLE_POLICY_VERSION ||
    (await computeMetamorphicFixtureEvidenceHash(parsed.data)) !== parsed.data.evidence_hash ||
    (await computeMetamorphicFixtureReceiptHash(parsed.data)) !== parsed.data.receipt_hash ||
    !(await registration.verifyCommitted(reference.data)) ||
    !(await registration.verifyExactArtifactRevision(reference.data, parsed.data))
  ) {
    throw new MetamorphicEvidenceAuthorityError(
      "MetamorphicFixtureReceipt 的 Reference、Commit、Hash 或 Fixture Identity 不权威。",
    );
  }

  const singleMutationCases = parsed.data.cases.filter(
    (fixtureCase) => fixtureCase.relation_kind !== "HALF_OPEN_ADDITIVE_PARTITION",
  );
  const mutationRecords = await Promise.all(
    singleMutationCases.map(async (fixtureCase) => {
      const resolvedRecord = await registration.resolveCommitted(fixtureCase.mutation_record_ref);
      const record = fixtureMutationRecordSchema.safeParse(resolvedRecord);
      const recordHash = record.success
        ? await computeFixtureMutationRecordHash(record.data)
        : null;
      if (
        !record.success ||
        recordHash !== fixtureCase.mutation_record_ref.content_hash ||
        recordHash !== fixtureCase.mutation_descriptor_hash ||
        !sameJson(record.data.scope, parsed.data.scope) ||
        record.data.run_id !== parsed.data.run_id ||
        record.data.case_id !== fixtureCase.case_id ||
        record.data.relation_kind !== fixtureCase.relation_kind ||
        record.data.baseline_snapshot_id !== parsed.data.baseline.snapshot_id ||
        record.data.follow_up_snapshot_id !== fixtureCase.follow_up_snapshot_id ||
        !sameJson(record.data.witness, fixtureCase.witness) ||
        !(await registration.verifyCommitted(fixtureCase.mutation_record_ref)) ||
        !(await registration.verifyExactArtifactRevision(
          fixtureCase.mutation_record_ref,
          resolvedRecord,
        ))
      ) {
        throw new MetamorphicEvidenceAuthorityError(
          "MetamorphicFixtureReceipt 的 FixtureMutationRecord 未精确绑定 Hash、Scope、Run、Case、Relation、Snapshot 或 Witness。",
        );
      }
      return deepFreeze({
        reference: fixtureCase.mutation_record_ref,
        record: record.data,
      });
    }),
  );
  const selectionProbes = await Promise.all(
    parsed.data.cases.map(async (fixtureCase) => {
      const evidence = await resolveAuthoritativeSandboxEvidence(
        fixtureCase.selection_probe,
        registration.sandbox_authority,
      );
      const expectedSnapshotId =
        fixtureCase.relation_kind === "HALF_OPEN_ADDITIVE_PARTITION"
          ? fixtureCase.snapshot_id
          : fixtureCase.follow_up_snapshot_id;
      if (
        evidence.receipt.input_hash !== fixtureCase.selection_probe_input_hash ||
        evidence.receipt.snapshot_token !== expectedSnapshotId ||
        Date.parse(evidence.receipt.completed_at) > Date.parse(parsed.data.issued_at) ||
        !sameScopeAndRun(evidence.receipt.receipt_ref, parsed.data.receipt_ref)
      ) {
        throw new MetamorphicEvidenceAuthorityError(
          "Selection Probe 必须绑定 Case 声明的 Snapshot、Input Hash、Scope、Run 与签发时间。",
        );
      }
      return evidence;
    }),
  );
  const sandboxIdentity = ensureSameSandboxIdentity(selectionProbes);
  const candidate = deepFreeze(parsed.data);
  const closure = deepFreeze({
    receipt: candidate,
    mutation_records: mutationRecords,
    selection_probes: selectionProbes,
  });
  if (!(await verifyMetamorphicFixtureKernel(closure, registration))) {
    throw new MetamorphicEvidenceAuthorityError(
      "MetamorphicFixtureReceipt 未通过 Mutation/Selectedness 闭包复核。",
    );
  }
  const authoritative = markAuthoritativeMetamorphicFixtureReceipt(candidate);
  fixtureReceiptClosures.set(
    authoritative,
    deepFreeze({
      sandbox_identity: sandboxIdentity,
      selection_probes: selectionProbes,
    }),
  );
  return authoritative;
}

export async function authorizeMetamorphicOracleReceipt(
  referenceInput: unknown,
  authority: MetamorphicOracleAuthority,
): Promise<AuthoritativeMetamorphicOracleReceipt> {
  const registration = oracleAuthorities.get(authority);
  const reference = artifactReferenceFor("MetamorphicOracleReceipt").safeParse(referenceInput);
  if (!registration || !reference.success) {
    throw new MetamorphicEvidenceAuthorityError(
      "MetamorphicOracleReceipt 必须通过已注册 Authority 的完整 Reference 授权。",
    );
  }
  const parsed = metamorphicOracleReceiptSchema.safeParse(
    await registration.resolveCommitted(reference.data),
  );
  if (
    !parsed.success ||
    !sameReference(parsed.data.receipt_ref, reference.data) ||
    !sameJson(parsed.data.verifier, registration.identity) ||
    parsed.data.verifier_role !== "METAMORPHIC_VERIFIER" ||
    parsed.data.authority_role_policy_version !== AUTHORITY_ROLE_POLICY_VERSION ||
    (await computeMetamorphicOracleEvidenceHash(parsed.data)) !== parsed.data.evidence_hash ||
    (await computeMetamorphicOracleReceiptHash(parsed.data)) !== parsed.data.receipt_hash ||
    !(await registration.verifyCommitted(reference.data)) ||
    !(await registration.verifyExactArtifactRevision(reference.data, parsed.data))
  ) {
    throw new MetamorphicEvidenceAuthorityError(
      "MetamorphicOracleReceipt 的 Reference、Commit、Hash 或 Verifier Identity 不权威。",
    );
  }
  const fixture = await authorizeMetamorphicFixtureReceipt(
    parsed.data.fixture_receipt_ref,
    registration.fixture_authority,
  );
  if (
    !sameReference(fixture.sql_artifact_ref, parsed.data.sql_artifact_ref) ||
    !sameReference(fixture.receipt_ref, parsed.data.fixture_receipt_ref) ||
    Date.parse(fixture.issued_at) > Date.parse(parsed.data.evaluated_at)
  ) {
    throw new MetamorphicEvidenceAuthorityError(
      "MetamorphicOracleReceipt 必须绑定同一 Fixture/SqlArtifact，且不能早于 Fixture 签发。",
    );
  }

  const baseline = await resolveAuthoritativeSandboxEvidence(
    parsed.data.baseline,
    registration.sandbox_authority,
  );
  if (
    baseline.receipt.snapshot_token !== fixture.baseline.snapshot_id ||
    baseline.receipt.input_hash !== fixture.baseline.execution_input_hash ||
    Date.parse(baseline.receipt.completed_at) > Date.parse(parsed.data.evaluated_at)
  ) {
    throw new MetamorphicEvidenceAuthorityError(
      "Metamorphic Baseline 必须匹配 Fixture Snapshot/Input Hash 并先于 Oracle 完成。",
    );
  }

  const relationEvidence: AuthoritativeMetamorphicSandboxEvidence[] = [];
  for (const [index, sample] of parsed.data.relation_samples.entries()) {
    const fixtureCase = fixture.cases[index];
    if (
      !fixtureCase ||
      fixtureCase.relation_kind !== sample.relation_kind ||
      fixtureCase.case_id !== sample.case_id ||
      !sameJson(fixtureCase.witness, sample.witness) ||
      (await computeMetamorphicRelationSampleHash(sample)) !== sample.sample_hash
    ) {
      throw new MetamorphicEvidenceAuthorityError(
        "RelationSample 必须逐项匹配 Fixture Case/Witness/Sample Hash。",
      );
    }
    if (
      fixtureCase.relation_kind === "HALF_OPEN_ADDITIVE_PARTITION" &&
      sample.relation_kind === "HALF_OPEN_ADDITIVE_PARTITION"
    ) {
      const [left, right] = await Promise.all([
        resolveAuthoritativeSandboxEvidence(sample.left_partition, registration.sandbox_authority),
        resolveAuthoritativeSandboxEvidence(sample.right_partition, registration.sandbox_authority),
      ]);
      if (
        sample.whole_source !== "METAMORPHIC_BASELINE" ||
        sample.snapshot_id !== fixtureCase.snapshot_id ||
        baseline.receipt.input_hash !== fixtureCase.whole_execution_input_hash ||
        left.receipt.snapshot_token !== fixtureCase.snapshot_id ||
        right.receipt.snapshot_token !== fixtureCase.snapshot_id ||
        left.receipt.input_hash !== fixtureCase.left_execution_input_hash ||
        right.receipt.input_hash !== fixtureCase.right_execution_input_hash ||
        Date.parse(left.receipt.completed_at) > Date.parse(parsed.data.evaluated_at) ||
        Date.parse(right.receipt.completed_at) > Date.parse(parsed.data.evaluated_at)
      ) {
        throw new MetamorphicEvidenceAuthorityError(
          "Half-open whole/left/right 必须共享 Baseline Snapshot 并匹配三个 Input Hash。",
        );
      }
      relationEvidence.push(left, right);
      continue;
    }
    if (
      fixtureCase.relation_kind === "HALF_OPEN_ADDITIVE_PARTITION" ||
      sample.relation_kind === "HALF_OPEN_ADDITIVE_PARTITION"
    ) {
      throw new MetamorphicEvidenceAuthorityError("Fixture Case 与 RelationSample 判别不一致。");
    }
    const followUp = await resolveAuthoritativeSandboxEvidence(
      sample.follow_up,
      registration.sandbox_authority,
    );
    if (
      sample.follow_up_snapshot_id !== fixtureCase.follow_up_snapshot_id ||
      followUp.receipt.snapshot_token !== fixtureCase.follow_up_snapshot_id ||
      followUp.receipt.input_hash !== fixtureCase.follow_up_execution_input_hash ||
      Date.parse(followUp.receipt.completed_at) > Date.parse(parsed.data.evaluated_at)
    ) {
      throw new MetamorphicEvidenceAuthorityError(
        "Single-mutation Follow-up 必须匹配 Fixture Snapshot/Input Hash。",
      );
    }
    relationEvidence.push(followUp);
  }
  const sandboxIdentity = ensureSameSandboxIdentity([baseline, ...relationEvidence]);
  const fixtureClosure = fixtureReceiptClosures.get(fixture);
  if (!fixtureClosure || fixtureClosure.sandbox_identity !== sandboxIdentity) {
    throw new MetamorphicEvidenceAuthorityError(
      "Fixture Probe 与 Metamorphic 执行必须来自同一 Sandbox Authority。",
    );
  }
  const candidate = deepFreeze(parsed.data);
  const closure = deepFreeze({
    receipt: candidate,
    fixture,
    selection_probes: fixtureClosure.selection_probes,
    baseline,
    relation_evidence: relationEvidence,
  });
  const projection = await verifyMetamorphicOracleKernel(closure, registration);
  if (!projection) {
    throw new MetamorphicEvidenceAuthorityError(
      "MetamorphicOracleReceipt 未通过固定关系的 computed verdict 闭包。",
    );
  }
  const authoritative = markAuthoritativeMetamorphicOracleReceipt(candidate);
  authoritativeOracleReceiptAuthorities.set(authoritative, authority);
  oracleReceiptClosures.set(
    authoritative,
    deepFreeze({
      fixture,
      sandbox_identity: sandboxIdentity,
      relation_verifications: projection.relation_verifications,
      computed_verdict: projection.computed_verdict,
    }),
  );
  return authoritative;
}

export async function authorizeResultOracleReceipt(
  referenceInput: unknown,
  authority: ResultOracleReceiptAuthority,
  resolvedMetamorphic?: AuthoritativeMetamorphicOracleReceipt,
): Promise<AuthoritativeResultOracleReceipt> {
  const registration = resultAuthorities.get(authority);
  const reference = artifactReferenceFor("ResultOracleReceipt").safeParse(referenceInput);
  if (!registration || !reference.success) {
    throw new MetamorphicEvidenceAuthorityError(
      "ResultOracleReceipt 必须通过已注册 Authority 的完整 Reference 授权。",
    );
  }
  const parsed = resultOracleReceiptSchema.safeParse(
    await registration.resolveCommitted(reference.data),
  );
  if (
    !parsed.success ||
    !sameReference(parsed.data.receipt_ref, reference.data) ||
    !sameJson(parsed.data.producer, registration.identity) ||
    parsed.data.producer_role !== "RESULT_PRODUCER" ||
    parsed.data.authority_role_policy_version !== AUTHORITY_ROLE_POLICY_VERSION ||
    (await computeResultOracleEvidenceHash(parsed.data)) !== parsed.data.evidence_hash ||
    (await computeResultOracleReceiptHash(parsed.data)) !== parsed.data.receipt_hash ||
    !(await registration.verifyCommitted(reference.data)) ||
    !(await registration.verifyExactArtifactRevision(reference.data, parsed.data))
  ) {
    throw new MetamorphicEvidenceAuthorityError(
      "ResultOracleReceipt 的 Reference、Commit、Hash 或 Producer Identity 不权威。",
    );
  }
  const metamorphic =
    resolvedMetamorphic ??
    (await authorizeMetamorphicOracleReceipt(
      parsed.data.metamorphic_oracle_receipt_ref,
      registration.metamorphic_authority,
    ));
  const closure = oracleReceiptClosures.get(metamorphic);
  if (
    !closure ||
    !isAuthoritativeMetamorphicOracleReceipt(metamorphic) ||
    authoritativeOracleReceiptAuthorities.get(metamorphic) !== registration.metamorphic_authority ||
    !sameReference(parsed.data.metamorphic_oracle_receipt_ref, metamorphic.receipt_ref) ||
    !sameReference(parsed.data.sql_artifact_ref, metamorphic.sql_artifact_ref) ||
    !sameReference(parsed.data.result_artifact_ref, metamorphic.baseline.result_artifact_ref) ||
    parsed.data.metamorphic_verdict !== metamorphic.metamorphic_verdict ||
    Date.parse(metamorphic.evaluated_at) > Date.parse(parsed.data.evaluated_at)
  ) {
    throw new MetamorphicEvidenceAuthorityError(
      "ResultOracleReceipt 必须绑定同一 Metamorphic Receipt/Result/Verdict。",
    );
  }
  metamorphicAuthorityRolePolicySchema.parse({
    policy_version: parsed.data.authority_role_policy_version,
    role_identities: {
      FIXTURE_MUTATION: closure.fixture.issuer,
      SANDBOX_EXECUTION: closure.sandbox_identity.identity,
      METAMORPHIC_VERIFIER: metamorphic.verifier,
      RESULT_PRODUCER: parsed.data.producer,
    },
  });
  const candidate = deepFreeze(parsed.data);
  if (!verifyResultOracleKernel(candidate, metamorphic)) {
    throw new MetamorphicEvidenceAuthorityError(
      "ResultOracleReceipt 未通过 Result Producer 闭包复核。",
    );
  }
  return markAuthoritativeResultOracleReceipt(candidate, metamorphic);
}

export type AuthoritativeMetamorphicOracleProjection = Readonly<{
  fixture_receipt: AuthoritativeMetamorphicFixtureReceipt;
  sandbox_identity: AuthorityIdentity;
  relation_verifications: readonly MetamorphicKernelRelationVerification[];
  computed_verdict: "PASS" | "FAIL";
}>;

/**
 * 仅投影 contracts 固定 kernel 已经绑定到同一品牌 Meta Receipt 的计算闭包。
 * 未经本进程 Authorizer 品牌化的同形对象始终返回 null。
 */
export function getAuthoritativeMetamorphicOracleProjection(
  value: unknown,
): AuthoritativeMetamorphicOracleProjection | null {
  if (!isAuthoritativeMetamorphicOracleReceipt(value)) return null;
  const closure = oracleReceiptClosures.get(value);
  return closure
    ? deepFreeze({
        fixture_receipt: closure.fixture,
        sandbox_identity: closure.sandbox_identity.identity,
        relation_verifications: closure.relation_verifications,
        computed_verdict: closure.computed_verdict,
      })
    : null;
}

export {
  type AuthoritativeMetamorphicFixtureReceipt,
  type AuthoritativeMetamorphicOracleReceipt,
  type AuthoritativeResultOracleReceipt,
  isAuthoritativeMetamorphicFixtureReceipt,
  isAuthoritativeMetamorphicOracleReceipt,
  isAuthoritativeResultOracleReceipt,
  isAuthoritativeResultOracleReceiptForMetamorphic,
} from "./text2sql-evidence-brands.js";
