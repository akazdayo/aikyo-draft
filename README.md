# aikyo

Jev の型付き Choice と確率分布を使い、複数 Agent から次の話者を一人だけ選ぶ TypeScript ライブラリです。Agent ごとの発話意欲生成は行わず、会話全体と全候補を Jev が一度に評価します。

## 使い方

`TYPESAFE_API_KEY` を環境変数に設定してください。既定のモデルは `jev-latest` です。

```ts
import { Aikyo, InMemoryConversation, type AikyoAgent } from "@akazdayo/aikyo";

const alice: AikyoAgent = {
  id: "alice",
  description: "身近な例で話を前に進める、明るく好奇心旺盛な話者",
  async intoTurn() {
    return { participantId: "alice", content: "Hello" };
  },
};

const store = new InMemoryConversation({ participants: [{ id: "alice" }] });
const aikyo = new Aikyo({
  agents: [alice],
  store,
  jev: {
    model: "jev-latest",
    instructions: "会話を自然に前進させる次の話者を選んでください。",
  },
});

console.log(await aikyo.turn());
```

`turn()` の `selection` には選択結果に加えて、候補ごとの確率、idle の確率、confidence、モデル名、入力 token 数が含まれます。選ばれた Agent の発話生成が失敗した場合は、その確率順を再利用して次候補へ移るため、Jev を再呼び出ししません。

`onTiming` を設定すると、Jev の話者選定（`jev`）と各 Agent の発話生成（`generation`）にかかった時間を、ミリ秒単位の構造化イベントで受け取れます。デモでは `[timing] jev=123.4ms` の形式で出力します。

保存先は `ConversationStore` で差し替えられます。テストや独自 backend が必要な場合だけ `SpeakerSelector` を注入できます。

## Demo

[`demo/`](./demo) では、話者選定に Jev、発話生成に Vercel AI SDK 経由の OpenRouter `openai/gpt-5.6-luna` を使い、3人のキャラクターがラジオ番組のように会話します。

```sh
pnpm install
cp demo/.env.example demo/.env
# demo/.env に OPENROUTER_API_KEY と TYPESAFE_API_KEY を設定
pnpm demo
```
