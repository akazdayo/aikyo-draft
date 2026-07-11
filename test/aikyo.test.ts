import { describe, expect, it } from "vite-plus/test";
import { Aikyo, HighestScorePolicy, InMemoryConversation, type AikyoAgent } from "../src/index.js";

function agent(id: string, score: number, content = id): AikyoAgent {
  return {
    id,
    async wantsToSpeak() {
      return { score };
    },
    async intoTurn() {
      return { participantId: id, content };
    },
  };
}

describe("Aikyo", () => {
  it("highest bidder speaks and the message is appended", async () => {
    const store = new InMemoryConversation({
      participants: [{ id: "low" }, { id: "high" }],
    });
    const result = await new Aikyo({
      agents: [agent("low", 1), agent("high", 2)],
      store,
    }).turn();

    expect(result.status).toBe("spoken");
    if (result.status !== "spoken") return;
    expect(result.agentId).toBe("high");
    expect(store.snapshot().messages[0]?.content).toBe("high");
    expect(store.snapshot().revision).toBe(1);
  });

  it("bid failures and abstentions are excluded", async () => {
    const broken = agent("broken", 10);
    broken.wantsToSpeak = async () => {
      throw new Error("no bid");
    };
    const quiet = agent("quiet", 20);
    quiet.wantsToSpeak = async () => ({ score: 20, abstain: true });

    const result = await new Aikyo({
      agents: [broken, quiet],
      store: new InMemoryConversation({
        participants: [{ id: "broken" }, { id: "quiet" }],
      }),
    }).turn();

    expect(result.status).toBe("idle");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.phase).toBe("bid");
  });

  it("falls back after intoTurn failure", async () => {
    const first = agent("first", 10);
    first.intoTurn = async () => {
      throw new Error("generation failed");
    };

    const result = await new Aikyo({
      agents: [first, agent("second", 5)],
      store: new InMemoryConversation({
        participants: [{ id: "first" }, { id: "second" }],
      }),
    }).turn();

    expect(result.status).toBe("spoken");
    if (result.status !== "spoken") return;
    expect(result.agentId).toBe("second");
    expect(result.errors[0]?.agentId).toBe("first");
  });

  it("ties use agent insertion order", () => {
    const selected = new HighestScorePolicy().select({
      snapshot: { messages: [], participants: [], revision: 0 },
      bids: new Map([
        ["a", { score: 1 }],
        ["b", { score: 1 }],
      ]),
    });

    expect(selected).toBe("a");
  });

  it("revision conflict can re-evaluate bids", async () => {
    const inner = new InMemoryConversation({ participants: [{ id: "a" }] });
    let conflicts = 0;
    const store = {
      snapshot: () => inner.snapshot(),
      append(message: Parameters<typeof inner.append>[0], revision: number) {
        if (conflicts++ === 0) inner.updateContext("external update");
        inner.append(message, revision);
      },
    };
    let bids = 0;
    const candidate = agent("a", 1);
    candidate.wantsToSpeak = async () => ({ score: ++bids });

    const result = await new Aikyo({
      agents: [candidate],
      store,
      revisionRetries: 1,
    }).turn();

    expect(result.status).toBe("spoken");
    expect(bids).toBe(2);
    expect(inner.snapshot().revision).toBe(2);
  });

  it("rejects concurrent turns on the same coordinator", async () => {
    let releaseBid!: () => void;
    const pendingBid = new Promise<void>((resolve) => {
      releaseBid = resolve;
    });
    const candidate = agent("a", 1);
    candidate.wantsToSpeak = async () => {
      await pendingBid;
      return { score: 1 };
    };
    const aikyo = new Aikyo({
      agents: [candidate],
      store: new InMemoryConversation({ participants: [{ id: "a" }] }),
    });

    const firstTurn = aikyo.turn();
    const secondTurn = aikyo.turn();
    releaseBid();
    await expect(secondTurn).rejects.toThrow("A turn is already in progress");
    await expect(firstTurn).resolves.toMatchObject({ status: "spoken" });
  });

  it("reports a non-finite bid as a bid failure", async () => {
    const result = await new Aikyo({
      agents: [agent("a", Number.NaN)],
      store: new InMemoryConversation({ participants: [{ id: "a" }] }),
    }).turn();

    expect(result.status).toBe("idle");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ agentId: "a", phase: "bid" });
    expect(result.errors[0]?.error).toBeInstanceOf(TypeError);
  });

  it("falls back when an agent returns a message for another participant", async () => {
    const invalid = agent("a", 2);
    invalid.intoTurn = async () => ({ participantId: "b", content: "wrong" });
    const result = await new Aikyo({
      agents: [invalid, agent("b", 1)],
      store: new InMemoryConversation({ participants: [{ id: "a" }, { id: "b" }] }),
    }).turn();

    expect(result.status).toBe("spoken");
    if (result.status !== "spoken") return;
    expect(result.agentId).toBe("b");
    expect(result.errors[0]).toMatchObject({ agentId: "a", phase: "turn" });
  });

  it("rejects a policy selection that is not eligible", async () => {
    const aikyo = new Aikyo({
      agents: [agent("a", 1)],
      store: new InMemoryConversation({ participants: [{ id: "a" }] }),
      policy: { select: () => "missing" },
    });

    await expect(aikyo.turn()).rejects.toThrow("Policy selected an ineligible agent: missing");
  });

  it("throws after revision retries are exhausted", async () => {
    const inner = new InMemoryConversation({ participants: [{ id: "a" }] });
    const store = {
      snapshot: () => inner.snapshot(),
      append(message: Parameters<typeof inner.append>[0], revision: number) {
        inner.updateContext(Symbol("conflict"));
        inner.append(message, revision);
      },
    };
    let bids = 0;
    const candidate = agent("a", 1);
    candidate.wantsToSpeak = async () => ({ score: ++bids });

    await expect(
      new Aikyo({
        agents: [candidate],
        store,
        revisionRetries: 1,
      }).turn(),
    ).rejects.toThrow("Conversation revision changed");
    expect(bids).toBe(2);
  });

  it("returns idle when no agents are configured", async () => {
    const result = await new Aikyo({
      agents: [],
      store: new InMemoryConversation(),
    }).turn();

    expect(result).toMatchObject({ status: "idle", errors: [] });
  });
});

describe("InMemoryConversation", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])(
    "rejects invalid revision %s",
    (revision) => {
      expect(() => new InMemoryConversation({ revision })).toThrowError(
        new RangeError("revision must be a non-negative integer"),
      );
    },
  );

  it("accepts a non-negative integer revision", () => {
    expect(new InMemoryConversation({ revision: 2 }).snapshot().revision).toBe(2);
  });

  it("rejects duplicate participant ids", () => {
    expect(
      () =>
        new InMemoryConversation({
          participants: [{ id: "a" }, { id: "a" }],
        }),
    ).toThrow("Duplicate participant id: a");
  });

  it("rejects an initial message from an unknown participant", () => {
    expect(
      () =>
        new InMemoryConversation({
          participants: [{ id: "a" }],
          messages: [{ participantId: "missing", content: "hello" }],
        }),
    ).toThrow("Unknown participant id: missing");
  });

  it("rejects an appended message from an unknown participant without advancing revision", () => {
    const store = new InMemoryConversation({ participants: [{ id: "a" }] });

    expect(() => store.append({ participantId: "missing", content: "hello" }, 0)).toThrow(
      "Unknown participant id: missing",
    );
    expect(store.snapshot()).toMatchObject({ messages: [], revision: 0 });
  });
});
