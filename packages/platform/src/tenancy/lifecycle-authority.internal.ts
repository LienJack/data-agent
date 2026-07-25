import type { AppScope } from "@data-agent/contracts";
import type { AppCapability, BoundaryResult } from "./capability.js";

export interface InternalCapabilityLifecycleController {
  freezeWrites(value: unknown): BoundaryResult<AppCapability>;
  retire(value: unknown): BoundaryResult<AppCapability>;
  restoreScope(scope: AppScope): void;
  activateWrites(value: unknown): BoundaryResult<AppCapability>;
}

const controllers = new WeakMap<object, InternalCapabilityLifecycleController>();

export function registerLifecycleAuthority(
  authority: object,
  controller: InternalCapabilityLifecycleController,
): void {
  controllers.set(authority, controller);
}

export function resolveLifecycleAuthority(
  authority: object,
): InternalCapabilityLifecycleController | null {
  return controllers.get(authority) ?? null;
}
