import { HighestScorePolicy } from "./policy.js";
import { RevisionConflictError } from "./store.js";
import type {
  AgentMessage,
  AikyoAgent,
  ConversationSnapshot,
  ConversationStore,
  TurnBid,
  TurnPolicy,
} from "./types.js";

export type TurnErrorPhase = "bid" | "turn";
export interface TurnError {
  readonly agentId: string;
  readonly phase: TurnErrorPhase;
  readonly error: unknown;
}

export type TurnResult =
  | {
      readonly status: "spoken";
      readonly agentId: string;
      readonly message: AgentMessage;
      readonly snapshot: ConversationSnapshot;
      readonly errors: readonly TurnError[];
    }
  | {
      readonly status: "idle";
      readonly snapshot: ConversationSnapshot;
      readonly errors: readonly TurnError[];
    };

export interface AikyoOptions {
  readonly agents: readonly AikyoAgent[];
  readonly store: ConversationStore;
  readonly policy?: TurnPolicy;
  /** Number of complete re-evaluations allowed after an optimistic-lock conflict. */
  readonly revisionRetries?: number;
  readonly onError?: (error: TurnError) => void;
}

export class Aikyo {
  readonly #agents: ReadonlyMap<string, AikyoAgent>;
  readonly #store: ConversationStore;
  readonly #policy: TurnPolicy;
  readonly #revisionRetries: number;
  readonly #onError: ((error: TurnError) => void) | undefined;
  #running = false;

  constructor(options: AikyoOptions) {
    const agents = new Map<string, AikyoAgent>();
    for (const agent of options.agents) {
      if (agents.has(agent.id)) throw new Error(`Duplicate agent id: ${agent.id}`);
      agents.set(agent.id, agent);
    }
    this.#agents = agents;
    this.#store = options.store;
    this.#policy = options.policy ?? new HighestScorePolicy();
    this.#revisionRetries = options.revisionRetries ?? 0;
    if (!Number.isInteger(this.#revisionRetries) || this.#revisionRetries < 0) {
      throw new RangeError("revisionRetries must be a non-negative integer");
    }
    this.#onError = options.onError;
  }

  /** Runs exactly one coordinated turn. Concurrent calls on one instance are rejected. */
  async turn(signal: AbortSignal = new AbortController().signal): Promise<TurnResult> {
    if (this.#running) throw new Error("A turn is already in progress");
    this.#running = true;
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await this.#evaluate(signal);
        } catch (error) {
          if (!(error instanceof RevisionConflictError) || attempt >= this.#revisionRetries)
            throw error;
        }
      }
    } finally {
      this.#running = false;
    }
  }

  async #evaluate(signal: AbortSignal): Promise<TurnResult> {
    signal.throwIfAborted();
    const snapshot = await this.#store.snapshot();
    const errors: TurnError[] = [];
    const bids = new Map<string, TurnBid>();

    const bidResults = await Promise.all(
      [...this.#agents].map(async ([id, agent]) => {
        try {
          const bid = await agent.wantsToSpeak(snapshot);
          if (!Number.isFinite(bid.score)) throw new TypeError("TurnBid.score must be finite");
          return [id, bid] as const;
        } catch (error) {
          this.#record(errors, { agentId: id, phase: "bid", error });
          return null;
        }
      }),
    );
    // Preserve configured agent order so policies can use deterministic tie-breaking.
    for (const result of bidResults) if (result) bids.set(...result);

    while (bids.size > 0) {
      signal.throwIfAborted();
      const id = this.#policy.select({ snapshot, bids });
      if (id === null) break;
      const agent = this.#agents.get(id);
      const bid = bids.get(id);
      if (!agent || !bid || bid.abstain) {
        throw new Error(`Policy selected an ineligible agent: ${id}`);
      }
      bids.delete(id);
      try {
        const message = await agent.intoTurn({ snapshot, bid, signal });
        if (message.participantId !== id) {
          throw new Error(`Agent ${id} returned a message for ${message.participantId}`);
        }
        await this.#store.append(message, snapshot.revision);
        return { status: "spoken", agentId: id, message, snapshot, errors };
      } catch (error) {
        if (error instanceof RevisionConflictError) throw error;
        this.#record(errors, { agentId: id, phase: "turn", error });
      }
    }
    return { status: "idle", snapshot, errors };
  }

  #record(errors: TurnError[], error: TurnError): void {
    errors.push(error);
    this.#onError?.(error);
  }
}
