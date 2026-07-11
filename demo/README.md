# OpenAI-compatible API demo

Vercel AI SDKからOpenRouterを使い、ミカ、ケン、ソラがラジオ番組のようにトークする最小デモです。各ターンで3人が発話意欲を返し、aikyoが次の話者を選びます。

```sh
cp demo/.env.example demo/.env
# demo/.env に OPENROUTER_API_KEY を設定
```

リポジトリルートから実行します。

```sh
pnpm demo
```

モデルは `openai/gpt-5.6-luna`、reasoning effortは `medium` です。
