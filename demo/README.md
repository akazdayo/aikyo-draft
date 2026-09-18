# Jev speaker selection demo

ミカ、ケン、ソラがラジオ番組のようにトークする最小デモです。各ターンで Jev が会話全体と3人の役割から次の話者を一度に選び、選ばれた話者の発話を Vercel AI SDK 経由の OpenRouter で生成します。

```sh
cp demo/.env.example demo/.env
# demo/.env に OPENROUTER_API_KEY と TYPESAFE_API_KEY を設定
```

リポジトリルートから実行します。

```sh
pnpm demo
```

話者選定モデルは `jev-latest`、発話生成モデルは `openai/gpt-5.6-luna`（reasoning effort: `medium`）です。

各ターンで Jev の全候補と `idle` の確率を高い順に表示し、選択された候補には `*` が付きます。

話者には重ならない専門役割があります。

- ミカ: 日常の利用場面とユーザー体験に落とし込む「生活実装」
- ケン: 前提、費用、プライバシー、安全性などを点検する「検証とリスク分析」
- ソラ: 意外な未来像や問いで議論を広げる「未来構想」
