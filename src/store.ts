import type {
  AgentMessage,
  ConversationSnapshot,
  ConversationStore,
  Message,
  Participant,
} from "./types.js";

export class RevisionConflictError extends Error {
  constructor(readonly expected: number, readonly actual: number) {
    super(`Conversation revision changed (expected ${expected}, actual ${actual})`);
    this.name = "RevisionConflictError";
  }
}

export class InMemoryConversation implements ConversationStore {
  readonly #messages: Message[];
  readonly #participants: Participant[];
  #context: unknown;
  #revision = 0;

  constructor(input: {
    messages?: readonly Message[];
    participants?: readonly Participant[];
    context?: unknown;
    revision?: number;
  } = {}) {
    this.#messages = [...(input.messages ?? [])];
    this.#participants = [...(input.participants ?? [])];
    this.#context = input.context;
    this.#revision = input.revision ?? 0;
  }

  snapshot(): ConversationSnapshot {
    const base = {
      messages: Object.freeze([...this.#messages]),
      participants: Object.freeze([...this.#participants]),
      revision: this.#revision,
    };
    return Object.freeze(
      this.#context === undefined ? base : { ...base, context: this.#context },
    );
  }

  append(message: AgentMessage, expectedRevision: number): void {
    if (expectedRevision !== this.#revision) {
      throw new RevisionConflictError(expectedRevision, this.#revision);
    }
    this.#messages.push(message);
    this.#revision += 1;
  }

  updateContext(context: unknown): void {
    this.#context = context;
    this.#revision += 1;
  }
}
