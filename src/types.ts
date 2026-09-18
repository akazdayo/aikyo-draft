export interface Message {
  readonly id?: string;
  readonly participantId: string;
  readonly content: unknown;
  readonly createdAt?: Date;
}

export interface AgentMessage extends Message {}

export interface Participant {
  readonly id: string;
  readonly name?: string;
  readonly metadata?: unknown;
}

export interface ConversationSnapshot {
  readonly messages: readonly Message[];
  readonly participants: readonly Participant[];
  readonly context?: unknown;
  readonly revision: number;
}

export interface TurnContext {
  readonly snapshot: ConversationSnapshot;
  readonly signal: AbortSignal;
}

export interface AikyoAgent {
  readonly id: string;
  /** What distinguishes this speaker. Jev uses this when choosing the next turn. */
  readonly description?: string;
  intoTurn(context: TurnContext): Promise<AgentMessage>;
}

export interface SpeakerCandidate {
  readonly id: string;
  readonly description?: string;
}

export interface SpeakerSelection {
  readonly agentId: string | null;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly idleProbability: number;
  readonly model: string;
  readonly inputTokens: number;
}

export interface SpeakerSelector {
  select(input: {
    readonly snapshot: ConversationSnapshot;
    readonly candidates: readonly SpeakerCandidate[];
    readonly signal: AbortSignal;
  }): Promise<SpeakerSelection>;
}

export interface ConversationStore {
  snapshot(): ConversationSnapshot | Promise<ConversationSnapshot>;
  append(message: AgentMessage, expectedRevision: number): void | Promise<void>;
}
