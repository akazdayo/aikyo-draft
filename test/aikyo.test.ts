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
    const store = new InMemoryConversation();
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
      store: new InMemoryConversation(),
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
      store: new InMemoryConversation(),
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
    const inner = new InMemoryConversation();
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
});
