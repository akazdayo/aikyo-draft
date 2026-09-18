import "dotenv/config";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { Aikyo, InMemoryConversation, type AikyoAgent, type ConversationSnapshot } from "aikyo";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("demo/.env に OPENROUTER_API_KEY を設定してください");
if (!process.env.TYPESAFE_API_KEY) {
  throw new Error("demo/.env に TYPESAFE_API_KEY を設定してください");
}

const openrouter = createOpenRouter({ apiKey });
const model = openrouter.chat("deepseek/deepseek-v4.1-flash", {
  reasoning: { effort: "medium" },
});

async function chat(instructions: string, prompt: string): Promise<string> {
  const { text } = await generateText({
    model,
    instructions,
    prompt,
  });
  return text.trim();
}

const history = (snapshot: ConversationSnapshot): string =>
  snapshot.messages
    .map((message) => `${message.participantId}: ${String(message.content)}`)
    .join("\n");

class OpenAICompatibleAgent implements AikyoAgent {
  constructor(
    readonly id: string,
    readonly description: string,
  ) {}

  async intoTurn({ snapshot }: Parameters<AikyoAgent["intoTurn"]>[0]) {
    const content = await chat(
      `${this.description}\nあなたはラジオ番組のパーソナリティです。相方の話を受けて、自然な日本語で1〜2文だけ話してください。名前の前置きは不要です。`,
      history(snapshot),
    );
    return { participantId: this.id, content };
  }
}

const store = new InMemoryConversation({
  participants: [{ id: "producer" }, { id: "ミカ" }, { id: "ケン" }, { id: "ソラ" }],
  messages: [{ participantId: "producer", content: "今日のテーマは『AIと暮らす未来』です。" }],
});

const aikyo = new Aikyo({
  store,
  onError: ({ agentId, phase, error }) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${agentId}] ${phase} failed: ${message}`);
  },
  onTiming: ({ phase, durationMs, attempt, agentId }) => {
    const retry = attempt === 0 ? "" : ` retry=${attempt}`;
    const speaker = agentId === undefined ? "" : ` agent=${agentId}`;
    console.log(`[timing] ${phase}=${durationMs.toFixed(1)}ms${speaker}${retry}`);
  },
  agents: [
    new OpenAICompatibleAgent("ミカ", "明るく好奇心旺盛で、身近な例を話す人です。"),
    new OpenAICompatibleAgent("ケン", "落ち着いた聞き上手で、少し違う視点を添える人です。"),
    new OpenAICompatibleAgent("ソラ", "ユーモアがあり、話を広げる素朴な疑問を投げかける人です。"),
  ],
});

console.log("📻 今日のテーマ：AIと暮らす未来\n");

for (let turn = 0; turn < 5; turn += 1) {
  const result = await aikyo.turn();
  const candidates = [
    ...Object.entries(result.selection.probabilities),
    ["idle", result.selection.idleProbability] as const,
  ].sort(([, left], [, right]) => right - left);
  console.log(
    `[jev] model=${result.selection.model} confidence=${result.selection.confidence.toFixed(3)}`,
  );
  for (const [id, probability] of candidates) {
    const selected = result.selection.agentId === id || (result.selection.agentId === null && id === "idle");
    console.log(`[jev] ${selected ? "*" : " "} ${id}: ${probability.toFixed(4)}`);
  }
  if (result.status === "idle") {
    console.error("発話できるキャラクターがいないため終了しました。");
    break;
  }
  console.log(`${result.agentId}: ${String(result.message.content)}\n`);
}
