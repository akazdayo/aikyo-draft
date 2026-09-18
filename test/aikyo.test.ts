import { TypeSafeClient } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vite-plus/test";
import {
  Aikyo,
  InMemoryConversation,
  JevSpeakerSelector,
  type AikyoAgent,
  type SpeakerSelection,
  type SpeakerSelector,
} from "../src/index.js";

function agent(id: string, content = id): AikyoAgent {
  return {
    id,
    description: `${id}の役割`,
    async intoTurn() {
      return { participantId: id, content };
    },
  };
}

function selection(id: string | null, probabilities: Record<string, number> = {}): SpeakerSelection {
  return {
    agentId: id,
    confidence: 0.9,
    probabilities,
    idleProbability: id === null ? 1 : 0,
    model: "test",
    inputTokens: 1,
  };
}

const selector = (result: SpeakerSelection): SpeakerSelector => ({ select: async () => result });

describe("Aikyo", () => {
  it("asks once and appends the selected speaker's message", async () => {
    const store = new InMemoryConversation({ participants: [{ id: "a" }, { id: "b" }] });
    let calls = 0;
    const timings: string[] = [];
    const result = await new Aikyo({
      agents: [agent("a"), agent("b")],
      store,
      selector: {
        async select({ candidates }) {
          calls += 1;
          expect(candidates).toEqual([
            { id: "a", description: "aの役割" },
            { id: "b", description: "bの役割" },
          ]);
          return selection("b", { a: 0.2, b: 0.8 });
        },
      },
      onTiming({ phase, durationMs, agentId }) {
        expect(durationMs).toBeGreaterThanOrEqual(0);
        timings.push(`${phase}:${agentId ?? "-"}`);
      },
    }).turn();

    expect(result).toMatchObject({ status: "spoken", agentId: "b" });
    expect(calls).toBe(1);
    expect(timings).toEqual([
      "jev:-",
      "generation:b",
    ]);
    expect(store.snapshot()).toMatchObject({ revision: 1, messages: [{ content: "b" }] });
  });

  it("returns idle when Jev selects idle", async () => {
    const result = await new Aikyo({
      agents: [agent("a")],
      store: new InMemoryConversation({ participants: [{ id: "a" }] }),
      selector: selector(selection(null)),
    }).turn();
    expect(result).toMatchObject({ status: "idle", errors: [] });
  });

  it("falls back by Jev probability after generation failure", async () => {
    const first = agent("first");
    first.intoTurn = async () => {
      throw new Error("generation failed");
    };
    const result = await new Aikyo({
      agents: [agent("third"), first, agent("second")],
      store: new InMemoryConversation({
        participants: [{ id: "first" }, { id: "second" }, { id: "third" }],
      }),
      selector: selector(selection("first", { first: 0.6, second: 0.3, third: 0.1 })),
    }).turn();
    expect(result).toMatchObject({
      status: "spoken",
      agentId: "second",
      errors: [{ agentId: "first", phase: "turn" }],
    });
  });

  it("rejects an ineligible selection", async () => {
    const aikyo = new Aikyo({
      agents: [agent("a")],
      store: new InMemoryConversation({ participants: [{ id: "a" }] }),
      selector: selector(selection("missing")),
    });
    await expect(aikyo.turn()).rejects.toThrow("Selector selected an ineligible agent: missing");
  });

  it("re-evaluates Jev after a revision conflict", async () => {
    const inner = new InMemoryConversation({ participants: [{ id: "a" }] });
    let conflicts = 0;
    const store = {
      snapshot: () => inner.snapshot(),
      append(message: Parameters<typeof inner.append>[0], revision: number) {
        if (conflicts++ === 0) inner.updateContext("external update");
        inner.append(message, revision);
      },
    };
    let selections = 0;
    const result = await new Aikyo({
      agents: [agent("a")],
      store,
      revisionRetries: 1,
      selector: { select: async () => (selections++, selection("a", { a: 1 })) },
    }).turn();
    expect(result.status).toBe("spoken");
    expect(selections).toBe(2);
  });

  it("rejects concurrent turns", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const aikyo = new Aikyo({
      agents: [agent("a")],
      store: new InMemoryConversation({ participants: [{ id: "a" }] }),
      selector: {
        async select() {
          await pending;
          return selection("a", { a: 1 });
        },
      },
    });
    const first = aikyo.turn();
    const second = aikyo.turn();
    release();
    await expect(second).rejects.toThrow("A turn is already in progress");
    await expect(first).resolves.toMatchObject({ status: "spoken" });
  });
});

describe("JevSpeakerSelector", () => {
  it("maps opaque choices and probabilities back to agent IDs", async () => {
    let body: unknown;
    const client = new TypeSafeClient({
      apiKey: "test",
      fetch: async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            model: "jev-test",
            answers: {
              nextSpeaker: {
                type: "choice",
                choice: "speaker_1",
                confidence: 0.88,
                probabilities: { idle: 0.02, speaker_0: 0.1, speaker_1: 0.88 },
              },
            },
            usage: { input_tokens: 42, output_tokens: 0 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    const result = await new JevSpeakerSelector({ client }).select({
      snapshot: {
        messages: [{ participantId: "producer", content: "テーマ" }],
        participants: [{ id: "a" }, { id: "idle" }],
        revision: 0,
      },
      candidates: [{ id: "a", description: "明るい" }, { id: "idle" }],
      signal: new AbortController().signal,
    });
    expect(result).toEqual({
      agentId: "idle",
      confidence: 0.88,
      probabilities: { a: 0.1, idle: 0.88 },
      idleProbability: 0.02,
      model: "jev-test",
      inputTokens: 42,
    });
    expect(body).toMatchObject({
      model: "jev-latest",
      state: { conversation: [{ speaker: "producer", content: "テーマ" }] },
      questions: {
        nextSpeaker: { type: "choice", criteria: { idle: expect.any(String), speaker_0: "明るい" } },
      },
    });
  });
});

describe("InMemoryConversation", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])("rejects invalid revision %s", (revision) => {
    expect(() => new InMemoryConversation({ revision })).toThrow(
      "revision must be a non-negative integer",
    );
  });

  it("rejects duplicate and unknown participant ids", () => {
    expect(() => new InMemoryConversation({ participants: [{ id: "a" }, { id: "a" }] })).toThrow(
      "Duplicate participant id: a",
    );
    const store = new InMemoryConversation({ participants: [{ id: "a" }] });
    expect(() => store.append({ participantId: "missing", content: "hello" }, 0)).toThrow(
      "Unknown participant id: missing",
    );
    expect(store.snapshot()).toMatchObject({ messages: [], revision: 0 });
  });
});
