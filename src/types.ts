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

export interface TurnBid {
  readonly score: number;
  readonly abstain?: boolean;
}

export interface TurnContext {
  readonly snapshot: ConversationSnapshot;
  readonly bid: TurnBid;
  readonly signal: AbortSignal;
}

export interface AikyoAgent {
  readonly id: string;
  wantsToSpeak(snapshot: ConversationSnapshot): Promise<TurnBid>;
  intoTurn(context: TurnContext): Promise<AgentMessage>;
}

export interface TurnPolicy {
  select(input: {
    snapshot: ConversationSnapshot;
    bids: ReadonlyMap<string, TurnBid>;
  }): string | null;
}

export interface ConversationStore {
  snapshot(): ConversationSnapshot | Promise<ConversationSnapshot>;
  append(message: AgentMessage, expectedRevision: number): void | Promise<void>;
}
