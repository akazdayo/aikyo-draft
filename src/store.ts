import type {
  AgentMessage,
  ConversationSnapshot,
  ConversationStore,
  Message,
  Participant,
} from "./types.js";

export class RevisionConflictError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`Conversation revision changed (expected ${expected}, actual ${actual})`);
    this.name = "RevisionConflictError";
  }
}

export class InMemoryConversation implements ConversationStore {
  readonly #messages: Message[];
  readonly #participants: Participant[];
  #context: unknown;
  #revision = 0;

  constructor(
    input: {
      messages?: readonly Message[];
      participants?: readonly Participant[];
      context?: unknown;
      revision?: number;
    } = {},
  ) {
    const revision = input.revision ?? 0;
    if (!Number.isInteger(revision) || revision < 0) {
      throw new RangeError("revision must be a non-negative integer");
    }

    const participants = [...(input.participants ?? [])];
    const participantIds = new Set<string>();
    for (const participant of participants) {
      if (participantIds.has(participant.id)) {
        throw new Error(`Duplicate participant id: ${participant.id}`);
      }
      participantIds.add(participant.id);
    }

    const messages = [...(input.messages ?? [])];
    for (const message of messages) {
      if (!participantIds.has(message.participantId)) {
        throw new Error(`Unknown participant id: ${message.participantId}`);
      }
    }

    this.#messages = messages;
    this.#participants = participants;
    this.#context = input.context;
    this.#revision = revision;
  }

  snapshot(): ConversationSnapshot {
    const base = {
      messages: Object.freeze([...this.#messages]),
      participants: Object.freeze([...this.#participants]),
      revision: this.#revision,
    };
    return Object.freeze(this.#context === undefined ? base : { ...base, context: this.#context });
  }

  append(message: AgentMessage, expectedRevision: number): void {
    if (expectedRevision !== this.#revision) {
      throw new RevisionConflictError(expectedRevision, this.#revision);
    }
    if (!this.#participants.some(({ id }) => id === message.participantId)) {
      throw new Error(`Unknown participant id: ${message.participantId}`);
    }
    this.#messages.push(message);
    this.#revision += 1;
  }

  updateContext(context: unknown): void {
    this.#context = context;
    this.#revision += 1;
  }
}
