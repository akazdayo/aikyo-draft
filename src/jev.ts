import { choice, TypeSafeClient, type TypeSafeClientConfig } from "@typesafe-ai/sdk";
import type { ConversationSnapshot, SpeakerSelection, SpeakerSelector } from "./types.js";

const IDLE = "idle";

export interface JevSpeakerSelectorOptions {
  readonly client?: TypeSafeClient;
  readonly clientConfig?: TypeSafeClientConfig;
  readonly model?: string;
  readonly instructions?: string;
}

/** Uses Jev's single-pass choice probabilities to select and rank speakers. */
export class JevSpeakerSelector implements SpeakerSelector {
  readonly #client: TypeSafeClient;
  readonly #model: string | undefined;
  readonly #instructions: string;

  constructor(options: JevSpeakerSelectorOptions = {}) {
    this.#client = options.client ?? new TypeSafeClient(options.clientConfig);
    this.#model = options.model;
    this.#instructions =
      options.instructions ??
      "会話の流れを自然に前進させる次の話者を一人選んでください。連続発話、発言の偏り、各候補の役割を考慮し、今は誰も話すべきでなければ idle を選んでください。";
  }

  async select({
    snapshot,
    candidates,
    signal,
  }: Parameters<SpeakerSelector["select"]>[0]): Promise<SpeakerSelection> {
    if (candidates.length === 0) return emptySelection();

    // Opaque labels avoid collisions with the reserved idle choice and accept arbitrary agent IDs.
    const labels = new Map<string, string>();
    const criteria: Record<string, string> = {
      [IDLE]: "会話をここで止める、または今は誰も発話しない",
    };
    candidates.forEach((candidate, index) => {
      const label = `speaker_${index}`;
      labels.set(label, candidate.id);
      criteria[label] = candidate.description ?? `話者 ${candidate.id}`;
    });

    const result = await this.#client.systemOne(
      {
        state: jevState(snapshot),
        questions: { nextSpeaker: choice(this.#instructions, criteria) },
        ...(this.#model === undefined ? {} : { model: this.#model }),
      },
      { signal },
    );
    const answer = result.answers.nextSpeaker;
    const probabilities: Record<string, number> = {};
    for (const [label, probability] of Object.entries(answer.probabilities)) {
      const id = labels.get(label);
      if (id !== undefined) probabilities[id] = probability;
    }

    return {
      agentId: answer.choice === IDLE ? null : (labels.get(answer.choice) ?? null),
      confidence: answer.confidence,
      probabilities,
      idleProbability: answer.probabilities[IDLE] ?? 0,
      model: result.model,
      inputTokens: result.usage.input_tokens,
    } satisfies SpeakerSelection;
  }
}

function jevState(snapshot: ConversationSnapshot) {
  return {
    conversation: snapshot.messages.map((message) => ({
      speaker: message.participantId,
      content: display(message.content),
    })),
    participants: snapshot.participants.map((participant) => ({
      id: participant.id,
      ...(participant.name === undefined ? {} : { name: participant.name }),
    })),
    ...(snapshot.context === undefined ? {} : { context: display(snapshot.context) }),
  };
}

function display(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function emptySelection(): SpeakerSelection {
  return {
    agentId: null,
    confidence: 1,
    probabilities: {},
    idleProbability: 1,
    model: "none",
    inputTokens: 0,
  };
}
