# aikyo

複数の Agent から発話意欲を集め、次の話者を一人だけ選ぶ TypeScript ライブラリです。

## 使い方

```ts
import { Aikyo, InMemoryConversation, type AikyoAgent } from "@akazdayo/aikyo";

const alice: AikyoAgent = {
  id: "alice",
  async wantsToSpeak() {
    return { score: 1 };
  },
  async intoTurn() {
    return { participantId: "alice", content: "Hello" };
  },
};

const store = new InMemoryConversation({ participants: [{ id: "alice" }] });
const aikyo = new Aikyo({ agents: [alice], store });

console.log(await aikyo.turn());
```

選出ルールは `TurnPolicy`、保存先は `ConversationStore` で差し替えられます。

## Demo

[`demo/`](./demo) では、Vercel AI SDKからOpenRouterの `openai/gpt-5.6-luna`（reasoning effort: `medium`）を使い、3人のキャラクターがラジオ番組のように会話します。

```sh
pnpm install
cp demo/.env.example demo/.env
# demo/.env に OPENROUTER_API_KEY を設定
pnpm demo
```
