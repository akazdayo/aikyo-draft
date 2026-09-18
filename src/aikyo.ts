import { JevSpeakerSelector, type JevSpeakerSelectorOptions } from "./jev.js";
import { RevisionConflictError } from "./store.js";
import type {
  AgentMessage,
  AikyoAgent,
  ConversationSnapshot,
  ConversationStore,
  SpeakerSelection,
  SpeakerSelector,
} from "./types.js";

export type TurnErrorPhase = "turn";
export interface TurnError {
  readonly agentId: string;
  readonly phase: TurnErrorPhase;
  readonly error: unknown;
}

export type TurnTimingPhase = "jev" | "generation";
export interface TurnTiming {
  readonly phase: TurnTimingPhase;
  readonly durationMs: number;
  /** Zero-based evaluation attempt. Greater than zero means a revision-conflict retry. */
  readonly attempt: number;
  readonly agentId?: string;
}

export type TurnResult =
  | {
      readonly status: "spoken";
      readonly agentId: string;
      readonly message: AgentMessage;
      readonly snapshot: ConversationSnapshot;
      readonly selection: SpeakerSelection;
      readonly errors: readonly TurnError[];
    }
  | {
      readonly status: "idle";
      readonly snapshot: ConversationSnapshot;
      readonly selection: SpeakerSelection;
      readonly errors: readonly TurnError[];
    };

export interface AikyoOptions {
  readonly agents: readonly AikyoAgent[];
  readonly store: ConversationStore;
  /** Override for tests or a custom selection backend. Defaults to Jev. */
  readonly selector?: SpeakerSelector;
  readonly jev?: JevSpeakerSelectorOptions;
  /** Number of complete re-evaluations allowed after an optimistic-lock conflict. */
  readonly revisionRetries?: number;
  readonly onError?: (error: TurnError) => void;
  readonly onTiming?: (timing: TurnTiming) => void;
}

export class Aikyo {
  readonly #agents: ReadonlyMap<string, AikyoAgent>;
  readonly #store: ConversationStore;
  readonly #selector: SpeakerSelector;
  readonly #revisionRetries: number;
  readonly #onError: ((error: TurnError) => void) | undefined;
  readonly #onTiming: ((timing: TurnTiming) => void) | undefined;
  #running = false;

  constructor(options: AikyoOptions) {
    const agents = new Map<string, AikyoAgent>();
    for (const agent of options.agents) {
      if (agents.has(agent.id)) throw new Error(`Duplicate agent id: ${agent.id}`);
      agents.set(agent.id, agent);
    }
    this.#agents = agents;
    this.#store = options.store;
    if (options.selector && options.jev) {
      throw new Error("selector and jev cannot be configured together");
    }
    this.#selector = options.selector ?? new JevSpeakerSelector(options.jev);
    this.#revisionRetries = options.revisionRetries ?? 0;
    if (!Number.isInteger(this.#revisionRetries) || this.#revisionRetries < 0) {
      throw new RangeError("revisionRetries must be a non-negative integer");
    }
    this.#onError = options.onError;
    this.#onTiming = options.onTiming;
  }

  /** Runs exactly one coordinated turn. Concurrent calls on one instance are rejected. */
  async turn(signal: AbortSignal = new AbortController().signal): Promise<TurnResult> {
    if (this.#running) throw new Error("A turn is already in progress");
    this.#running = true;
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await this.#evaluate(signal, attempt);
        } catch (error) {
          if (!(error instanceof RevisionConflictError) || attempt >= this.#revisionRetries)
            throw error;
        }
      }
    } finally {
      this.#running = false;
    }
  }

  async #evaluate(signal: AbortSignal, attempt: number): Promise<TurnResult> {
    signal.throwIfAborted();
    const snapshot: ConversationSnapshot = await this.#store.snapshot();
    const errors: TurnError[] = [];
    const selectionStartedAt = performance.now();
    let selection: SpeakerSelection;
    try {
      selection = await this.#selector.select({
        snapshot,
        candidates: [...this.#agents.values()].map(({ id, description }) => ({
          id,
          ...(description === undefined ? {} : { description }),
        })),
        signal,
      });
    } finally {
      this.#timing({
        phase: "jev",
        durationMs: performance.now() - selectionStartedAt,
        attempt,
      });
    }
    if (selection.agentId === null) return { status: "idle", snapshot, selection, errors };
    if (!this.#agents.has(selection.agentId)) {
      throw new Error(`Selector selected an ineligible agent: ${selection.agentId}`);
    }

    // Jev returns the whole distribution, so generation fallbacks need no second API call.
    const ranked = [...this.#agents.keys()].sort(
      (left, right) =>
        (selection.probabilities[right] ?? 0) - (selection.probabilities[left] ?? 0),
    );
    ranked.splice(ranked.indexOf(selection.agentId), 1);
    ranked.unshift(selection.agentId);

    for (const id of ranked) {
      signal.throwIfAborted();
      const agent = this.#agents.get(id);
      if (!agent) continue;
      try {
        const generationStartedAt = performance.now();
        let message: AgentMessage;
        try {
          message = await agent.intoTurn({ snapshot, signal });
        } finally {
          this.#timing({
            phase: "generation",
            durationMs: performance.now() - generationStartedAt,
            attempt,
            agentId: id,
          });
        }
        if (message.participantId !== id) {
          throw new Error(`Agent ${id} returned a message for ${message.participantId}`);
        }
        await this.#store.append(message, snapshot.revision);
        return { status: "spoken", agentId: id, message, snapshot, selection, errors };
      } catch (error) {
        if (error instanceof RevisionConflictError) throw error;
        this.#record(errors, { agentId: id, phase: "turn", error });
      }
    }
    return { status: "idle", snapshot, selection, errors };
  }

  #record(errors: TurnError[], error: TurnError): void {
    errors.push(error);
    this.#onError?.(error);
  }

  #timing(timing: TurnTiming): void {
    this.#onTiming?.(timing);
  }
}
