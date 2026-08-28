import "server-only";

import type { SemanticSuccessorStageEnvelope } from "@data-agent/contracts/artifacts";
import type { PortResult } from "@data-agent/contracts/ports";
import type { Falcon24SemanticAuthorityClosure } from "@data-agent/contracts/runs";

interface SemanticClosureReader {
  load(
    capability: unknown,
    input: { readonly semantic_domain: string },
  ): Promise<PortResult<Falcon24SemanticAuthorityClosure>>;
}

interface PromotedSuccessorReader {
  loadPromotedRelease(
    capability: unknown,
    input: { readonly semantic_domain: string; readonly release_id: string },
  ): Promise<PortResult<SemanticSuccessorStageEnvelope>>;
}

function required<T>(result: PortResult<T>): T {
  if (!result.ok) throw new TypeError(result.error.code);
  return result.value;
}

export function createFalcon24SuccessorFinalizationReadback(input: {
  readonly capability: unknown;
  readonly semantic_domain: string;
  readonly closure_reader: SemanticClosureReader;
  readonly successor_reader: PromotedSuccessorReader;
}) {
  return Object.freeze({
    async loadCurrentClosure(): Promise<Falcon24SemanticAuthorityClosure> {
      return required(
        await input.closure_reader.load(input.capability, {
          semantic_domain: input.semantic_domain,
        }),
      );
    },

    async loadPublishedRelease(locator: {
      readonly semantic_domain: string;
      readonly release_id: string;
    }): Promise<SemanticSuccessorStageEnvelope> {
      if (locator.semantic_domain !== input.semantic_domain) {
        throw new TypeError("FALCON24_SEMANTIC_SUCCESSOR_READBACK_SCOPE_MISMATCH");
      }
      return required(await input.successor_reader.loadPromotedRelease(input.capability, locator));
    },
  });
}
