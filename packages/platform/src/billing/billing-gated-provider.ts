import type { ModelBillingAuthorizationReceipt } from "@data-agent/contracts";
import type { BoundaryResult } from "../tenancy/capability.js";
import type { ModelBillingPort } from "./postgres-model-billing.js";

export interface BillingAuthorizedProviderResult<T> {
  readonly authorization: ModelBillingAuthorizationReceipt;
  readonly provider_result: T;
}

/**
 * The only ordinary-user provider entrypoint exposed by the billing composition.
 * The delegate remains unreachable unless the PostgreSQL Billing Port committed
 * a price snapshot and, in ENFORCED mode, an ACTIVE hold.
 */
export function createBillingGatedProvider<TInput, TOutput>(options: {
  readonly billing: Pick<ModelBillingPort, "authorize">;
  readonly invokeProvider: (
    input: TInput,
    authorization: ModelBillingAuthorizationReceipt,
  ) => Promise<TOutput>;
}) {
  return Object.freeze({
    async invoke(
      context: unknown,
      authorizationCommand: unknown,
      providerInput: TInput,
    ): Promise<BoundaryResult<BillingAuthorizedProviderResult<TOutput>>> {
      const authorization = await options.billing.authorize(context, authorizationCommand);
      if (!authorization.ok) return authorization;
      if (!authorization.value.provider_call_allowed) {
        return {
          ok: false,
          error: {
            code: "MODEL_BILLING_PROVIDER_CALL_DENIED",
            message: "模型计费未授权真实 Provider 调用。",
            retryable: false,
          },
        };
      }
      return {
        ok: true,
        value: {
          authorization: authorization.value,
          provider_result: await options.invokeProvider(providerInput, authorization.value),
        },
      };
    },
  });
}
