import assert from "node:assert/strict";
import test from "node:test";
import { Aikyo, HighestScorePolicy, InMemoryConversation } from "../dist/index.js";

const agent = (id, score, content = id) => ({
  id,
  async wantsToSpeak() { return { score }; },
  async intoTurn() { return { participantId: id, content }; },
});

test("highest bidder speaks and the message is appended", async () => {
  const store = new InMemoryConversation();
  const result = await new Aikyo({
    agents: [agent("low", 1), agent("high", 2)], store,
  }).turn();
  assert.equal(result.status, "spoken");
  assert.equal(result.agentId, "high");
  assert.equal(store.snapshot().messages[0].content, "high");
  assert.equal(store.snapshot().revision, 1);
});

test("bid failures and abstentions are excluded", async () => {
  const broken = agent("broken", 10);
  broken.wantsToSpeak = async () => { throw new Error("no bid"); };
  const result = await new Aikyo({
    agents: [broken, { ...agent("quiet", 20), wantsToSpeak: async () => ({ score: 20, abstain: true }) }],
    store: new InMemoryConversation(),
  }).turn();
  assert.equal(result.status, "idle");
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].phase, "bid");
});

test("falls back to the next policy choice after intoTurn failure", async () => {
  const first = agent("first", 10);
  first.intoTurn = async () => { throw new Error("generation failed"); };
  const result = await new Aikyo({
    agents: [first, agent("second", 5)], store: new InMemoryConversation(),
  }).turn();
  assert.equal(result.agentId, "second");
  assert.equal(result.errors[0].agentId, "first");
});

test("ties use agent insertion order", () => {
  const policy = new HighestScorePolicy();
  assert.equal(policy.select({ snapshot: {}, bids: new Map([["a", { score: 1 }], ["b", { score: 1 }]]) }), "a");
});

test("revision conflict can re-evaluate bids", async () => {
  const inner = new InMemoryConversation();
  let conflicts = 0;
  const store = {
    snapshot: () => inner.snapshot(),
    append(message, revision) {
      if (conflicts++ === 0) inner.updateContext("external update");
      inner.append(message, revision);
    },
  };
  let bids = 0;
  const candidate = agent("a", 1);
  candidate.wantsToSpeak = async () => ({ score: ++bids });
  const result = await new Aikyo({ agents: [candidate], store, revisionRetries: 1 }).turn();
  assert.equal(result.status, "spoken");
  assert.equal(bids, 2);
  assert.equal(inner.snapshot().revision, 2);
});
