# M2-3: Discord Developer Portal 設定と開発環境での起動確認

Issue #20 の作業手順。要件定義.md §16.1 環境 / §16.4 Discord 側の設定 / §19 R-01 に対応する。

この Issue の中心作業（Developer Portal の操作、Discord クライアントでの実機確認）は
Discord アカウントと実際の Discord クライアントを使う手動作業であり、リポジトリへの
コード変更だけでは完了できない。本ドキュメントは、その手動作業の手順と、
リポジトリ側で用意済み・追加した設定を対応付けるためのものである。

## 前提条件

- 対象は自分の Discord サーバーのみ（要件定義 §16.4）。一般公開・審査申請は行わない
- Discord Developer Portal でアプリケーションを作成済みで、Client ID を
  `packages/client/.env`（`.env.example` を参照）の `VITE_DISCORD_CLIENT_ID` に設定済みであること
- [cloudflared](https://github.com/cloudflare/cloudflared) をインストール済みであること
  （quick tunnel はアカウント登録不要で使える）

## 手順

### 1. Discord Developer Portal で Activity を有効化する（手動）

1. https://discord.com/developers/applications で対象アプリケーションを開く
2. 左メニューの **Activities → Settings** から Activity を有効化する
3. **Activities → URL Mappings** の画面を開いておく（手順3のトンネル URL をここで設定する）

### 2. サーバーと開発サーバーを起動する

```bash
# ターミナル1: API サーバー（既定で :3000）
npm run dev --workspace packages/server

# ターミナル2: Vite 開発サーバー（:5173、外部からの接続を受け付ける設定済み）
npm run dev --workspace packages/client
```

### 3. 開発用トンネルを起動する

```bash
npm run dev:tunnel --workspace packages/client
```

`https://<ランダムな文字列>.trycloudflare.com` 形式の URL が標準出力に表示される。
起動のたびにサブドメインが変わるため、`packages/client/vite.config.ts` の
`allowedHosts` は個別ホスト名ではなく `.trycloudflare.com` ワイルドカードを
既に設定済み（コミット db8ec92 時点）。

### 4. URL Mapping を設定する（手動）

Developer Portal の **URL Mappings** で、prefix `/` に対して手順3で得たトンネルの
ホスト名（`<ランダムな文字列>.trycloudflare.com`、スキームなし）を設定する。

### 5. Discord クライアントで起動確認する（手動）

1. 対象の Discord サーバーのボイスチャンネルに参加する
2. Activity 起動メニューから対象アプリケーションを選び、Activity を起動する
3. client の初期画面が iframe 内に表示されることを確認する

ブラウザで直接 `http://localhost:5173` を開いた場合は `frame_id` が付与されないため
`discordSdk.ts` の判定により `embedded: false` となり `DiscordSDKMock` にフォールバックする
（実機確認にはならないので、必ず手順5の手順で確認すること）。

## iframe 内の CSP に関する確認ポイント

Discord は Activity の iframe に対して CSP を課す。実装時点で該当しうる箇所は以下。

- `index.html` はインラインスクリプトを使わず `<script type="module" src="/src/main.tsx">`
  のみを読み込んでいる（インラインスクリプト・インラインイベントハンドラは CSP で
  ブロックされ得るため使用しない）
- API 呼び出しは `/api` または Discord プロキシ経由の `/.proxy/api` のみで、
  外部オリジンへの直接リクエストは行わない（`vite.config.ts` のプロキシ設定、
  要件定義 §15）
- 外部フォント・CDN 等の読み込みは現状なし。今後追加する場合は Discord 側の
  CSP 許可リストに抵触しないか実機で確認する

起動確認時に devtools のコンソールで CSP 違反（`Refused to ...` 等）が出ていないかを
必ず確認する。

## トラブルシューティング

| 症状 | 確認箇所 |
| --- | --- |
| Activity が真っ白のまま | devtools コンソールの CSP 違反 / `discordSdk.ts` の ready() タイムアウトメッセージ |
| Vite が接続を拒否する | `allowedHosts` にトンネルのホストが一致しているか（ワイルドカード `.trycloudflare.com` 設定済み） |
| HMR が繋がらない | `vite.config.ts` の `hmr.clientPort: 443`（https トンネル越しの想定）と一致しているか |
| API が 404 / 到達しない | `/api` と `/.proxy/api` の両方を server へ中継しているか（プロキシ設定） |

## 完了条件

- [ ] 開発環境で、Discord のボイスチャンネルから起動した Activity 内に
      client の初期画面が表示される（**手動確認・要ユーザー実施**）
