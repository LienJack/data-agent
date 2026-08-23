export interface ResearchReplayCounter {
  readonly hits: number;
  readonly misses: number;
  readonly coalesced: number;
  readonly unowned: number;
  readonly failed: number;
}

export interface ResearchReplayMetrics {
  readonly namespaces: Readonly<Record<string, ResearchReplayCounter>>;
  readonly totals: ResearchReplayCounter;
}

export interface ResearchRequestReplayContext {
  readonly scope: "REQUEST_LOCAL_VERIFIED_REPLAY";
}

interface MutableResearchReplayCounter {
  hits: number;
  misses: number;
  coalesced: number;
  unowned: number;
  failed: number;
}

interface ResearchRequestReplayState {
  readonly owned: WeakSet<object>;
  readonly caches: Map<string, WeakMap<object, unknown>>;
  readonly inFlight: Map<string, WeakMap<object, Promise<unknown>>>;
  readonly counters: Map<string, MutableResearchReplayCounter>;
}

const requestReplayContexts = new WeakSet<object>();
const requestReplayStates = new WeakMap<object, ResearchRequestReplayState>();

function replayState(context: ResearchRequestReplayContext): ResearchRequestReplayState {
  const state = requestReplayStates.get(context);
  if (!requestReplayContexts.has(context) || !state) {
    throw new TypeError("RESEARCH_REQUEST_REPLAY_CONTEXT_REQUIRED");
  }
  return state;
}

function counterFor(
  state: ResearchRequestReplayState,
  namespace: string,
): MutableResearchReplayCounter {
  const existing = state.counters.get(namespace);
  if (existing) return existing;
  const counter = { hits: 0, misses: 0, coalesced: 0, unowned: 0, failed: 0 };
  state.counters.set(namespace, counter);
  return counter;
}

function ownAndFreezeGraph(value: unknown, state: ResearchRequestReplayState): void {
  if (typeof value !== "object" || value === null || state.owned.has(value)) return;

  const discovered: object[] = [];
  const visiting = new WeakSet<object>();
  const visited = new WeakSet<object>();
  const visit = (candidate: unknown): void => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      state.owned.has(candidate) ||
      visited.has(candidate)
    ) {
      return;
    }
    if (visiting.has(candidate)) {
      throw new TypeError("RESEARCH_REPLAY_CONTEXT_REJECTS_CYCLES");
    }
    visiting.add(candidate);
    for (const key of Reflect.ownKeys(candidate)) {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) {
        throw new TypeError("RESEARCH_REPLAY_CONTEXT_ONLY_ACCEPTS_DATA_PROPERTIES");
      }
      visit(descriptor.value);
    }
    visiting.delete(candidate);
    visited.add(candidate);
    discovered.push(candidate);
  };

  visit(value);
  for (const candidate of discovered) {
    Object.freeze(candidate);
    state.owned.add(candidate);
  }
}

/**
 * Creates one request-local verified replay context.
 *
 * The context is an optimization capability only. It grants no persistence,
 * current-revision, execution, terminal, or release authority.
 */
export function createResearchRequestReplayContext(): ResearchRequestReplayContext {
  const context = Object.freeze({
    scope: "REQUEST_LOCAL_VERIFIED_REPLAY",
  }) as ResearchRequestReplayContext;
  requestReplayContexts.add(context);
  requestReplayStates.set(context, {
    owned: new WeakSet(),
    caches: new Map(),
    inFlight: new Map(),
    counters: new Map(),
  });
  return context;
}

/**
 * Registers an internal composition value with this request and recursively
 * freezes it before it can be used as a replay key.
 */
export function ownResearchReplayValue<T>(context: ResearchRequestReplayContext, value: T): T {
  ownAndFreezeGraph(value, replayState(context));
  return value;
}

export function isOwnedResearchReplayValue(
  context: ResearchRequestReplayContext,
  value: unknown,
): value is object {
  return (
    typeof value === "object" &&
    value !== null &&
    replayState(context).owned.has(value) &&
    Object.isFrozen(value)
  );
}

/**
 * Coalesces successful verification work only for the same recursively frozen
 * object owned by the same request context. Caller-claimed hashes and
 * canonical JSON equivalence are never cache keys.
 */
export function memoizeSuccessfulResearchReplay<Result extends { readonly ok: boolean }>(
  context: ResearchRequestReplayContext | undefined,
  namespace: string,
  input: unknown,
  replay: () => Promise<Result>,
): Promise<Result> {
  if (
    context === undefined ||
    typeof input !== "object" ||
    input === null ||
    !isOwnedResearchReplayValue(context, input)
  ) {
    if (context !== undefined) {
      counterFor(replayState(context), namespace).unowned += 1;
    }
    return replay();
  }

  const state = replayState(context);
  const counter = counterFor(state, namespace);
  let cache = state.caches.get(namespace);
  if (!cache) {
    cache = new WeakMap();
    state.caches.set(namespace, cache);
  }
  const cached = cache.get(input) as Result | undefined;
  if (cached !== undefined) {
    counter.hits += 1;
    return Promise.resolve(cached);
  }

  let inFlight = state.inFlight.get(namespace);
  if (!inFlight) {
    inFlight = new WeakMap();
    state.inFlight.set(namespace, inFlight);
  }
  const pending = inFlight.get(input);
  if (pending) {
    counter.coalesced += 1;
    return pending as Promise<Result>;
  }

  counter.misses += 1;
  // Promise chaining defers `replay` until after the in-flight slot is
  // published below. A synchronous throw can therefore never clean up before
  // the slot exists and leave a rejected Promise behind.
  const promise = Promise.resolve()
    .then(replay)
    .then((result) => {
      if (!result.ok) {
        counter.failed += 1;
        return result;
      }
      ownAndFreezeGraph(result, state);
      cache.set(input, result);
      return result;
    })
    .catch((error: unknown) => {
      counter.failed += 1;
      throw error;
    })
    .finally(() => {
      inFlight.delete(input);
    });
  inFlight.set(input, promise);
  return promise;
}

export function snapshotResearchReplayMetrics(
  context: ResearchRequestReplayContext,
): ResearchReplayMetrics {
  const state = replayState(context);
  const namespaces = Object.fromEntries(
    [...state.counters.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([namespace, counter]) => [namespace, Object.freeze({ ...counter })]),
  );
  const totals = Object.values(namespaces).reduce<MutableResearchReplayCounter>(
    (sum, counter) => ({
      hits: sum.hits + counter.hits,
      misses: sum.misses + counter.misses,
      coalesced: sum.coalesced + counter.coalesced,
      unowned: sum.unowned + counter.unowned,
      failed: sum.failed + counter.failed,
    }),
    { hits: 0, misses: 0, coalesced: 0, unowned: 0, failed: 0 },
  );
  return Object.freeze({
    namespaces: Object.freeze(namespaces),
    totals: Object.freeze(totals),
  });
}
