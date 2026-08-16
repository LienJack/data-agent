import "server-only";

export interface BillingUiEnvironment {
  readonly [key: string]: string | undefined;
  readonly BILLING_UI_ENABLED?: string;
}

/**
 * Billing remains a server-side authority while its product UI is paused.
 * Only an explicit opt-in restores the hidden control surfaces.
 */
export function isBillingUiEnabled(environment: BillingUiEnvironment = process.env): boolean {
  return environment.BILLING_UI_ENABLED === "1" || environment.BILLING_UI_ENABLED === "true";
}
