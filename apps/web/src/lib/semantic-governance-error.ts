export class SemanticGovernanceError extends Error {
  override readonly name = "SemanticGovernanceError";

  constructor(
    readonly code: string,
    message: string,
    readonly status: number = 400,
    readonly retryable = false,
  ) {
    super(message);
  }
}

const PUBLIC_ERRORS = {
  SEMANTIC_BACKEND_NOT_CONFIGURED: [500, "语义治理后端尚未配置。"],
  SEMANTIC_BACKEND_INVALID: [500, "语义治理后端配置无效。"],
  SEMANTIC_MOCK_FORBIDDEN: [500, "生产环境禁止使用语义治理 Mock 后端。"],
  SEMANTIC_DATABASE_NOT_CONFIGURED: [500, "语义治理数据库尚未配置。"],
  SEMANTIC_AUTHORITY_NOT_CONFIGURED: [500, "语义治理身份解析器尚未配置。"],
  SEMANTIC_UNAUTHENTICATED: [401, "当前请求尚未通过服务端身份验证。"],
  SEMANTIC_SCOPE_FORBIDDEN: [403, "当前身份无权访问该语义域。"],
  SEMANTIC_PACKET_NOT_FOUND: [404, "语义审核包不存在。"],
  SEMANTIC_CANDIDATE_INVALID: [400, "语义候选输入无效。"],
  SEMANTIC_CANDIDATE_CONFLICT: [409, "相同幂等键已绑定其他语义候选内容。"],
  SEMANTIC_PUBLISH_MATERIAL_REQUIRED: [400, "发布所需的权威材料不完整。"],
  SEMANTIC_ROLLBACK_AUTHORIZATION_REQUIRED: [400, "回滚所需的授权材料不完整。"],
  SEMANTIC_PUBLISH_CONFLICT: [409, "语义发布状态已变化，请刷新后重试。"],
  DATASOURCE_SECRET_PROVIDER_NOT_CONFIGURED: [503, "数据源 Secret Provider 尚未配置。"],
  DATASOURCE_CREDENTIAL_REF_INVALID: [400, "数据源凭据引用无效。"],
  DATASOURCE_CONNECTION_FAILED: [502, "数据源连接失败，请检查配置与网络。"],
  SEMANTIC_GOVERNANCE_UNAVAILABLE: [503, "语义治理服务暂时不可用。"],
} as const satisfies Record<string, readonly [number, string]>;

export type PublicSemanticGovernanceErrorCode = keyof typeof PUBLIC_ERRORS;

export function isPublicSemanticGovernanceErrorCode(
  code: string,
): code is PublicSemanticGovernanceErrorCode {
  return code in PUBLIC_ERRORS;
}

export function publicSemanticGovernanceError(
  code: PublicSemanticGovernanceErrorCode,
  retryable = false,
): SemanticGovernanceError {
  const [status, message] = PUBLIC_ERRORS[code];
  return new SemanticGovernanceError(code, message, status, retryable);
}

export function redactSemanticGovernanceError(error: unknown): SemanticGovernanceError {
  if (error instanceof SemanticGovernanceError && error.code in PUBLIC_ERRORS) {
    return publicSemanticGovernanceError(
      error.code as PublicSemanticGovernanceErrorCode,
      error.retryable,
    );
  }
  return publicSemanticGovernanceError("SEMANTIC_GOVERNANCE_UNAVAILABLE", true);
}
