# M2-5: Cloudflare Tunnel によるラズパイの公開とサブドメイン割当（詳細設計）

Issue #22 の詳細設計。要件定義.md §5.1 全体構成 / §13 制約条件 / §15 セキュリティ /
§16.2 構成 / §20 O-07 に対応する。

この Issue の中心作業は Cloudflare ダッシュボードの操作とラズパイ上での設定であり、
リポジトリへのコード変更だけでは完了できない。本書は、手動作業の手順・設定ファイルの
内容・リポジトリ側で行う変更を対応付け、作業の抜けを防ぐためのものである。

---

## 1. 前提と Issue 本文の訂正

### 1.1 前提条件

- ラズパイ上でオセロサーバー（`packages/server`）が起動できること（M2-1 で実装済み）
- Discord Developer Portal でアプリケーションを作成済みであること（M2-3）
- 独自ドメインを所有していること。ドメインレジストラの管理画面にログインできること
- Cloudflare アカウント（無料プランで足りる。要件定義 §13 予算）

### 1.2 既存環境（2026-09-01 時点で確認済み）

本 Issue はゼロからの構築ではなく、**既に稼働している Cloudflare Tunnel 環境への追加**である。

| 事実                                             | 確認内容                                                                                                          | 設計への影響                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `cloudflared` 導入済み（v2026.7.2）              | `cloudflared tunnel list` が動作                                                                                  | §5.1 の導入手順は不要。バージョン更新の判断のみ（§5.1）        |
| Cloudflare へ認可済み                            | 同上（`cert.pem` がなければ `tunnel list` は失敗する）                                                            | §4.2 の `cloudflared tunnel login` は不要                       |
| named tunnel が 4 本稼働中                       | `admiral-console` / `job-hunting-agent` / `shuukatu-back` / `yoko-switchbot`（いずれも複数コネクション確立済み） | §5.4 が**単一インスタンス前提では成り立たない**（§5.5 を追加） |
| **既定パスの設定ファイルが実在し、`tunnel:` を指定している** | `cloudflared tunnel info <name>` が名前によらず常に `shuukatu-back` を返す（§1.2.1）                    | **すべてのコマンドで `--config` の明示が必須**（§5.5）         |
| CPU アーキテクチャは arm64                       | `tunnel info` の ARCHITECTURE が `linux_arm64`                                                                    | ラズパイ（64bit OS）と整合。バイナリは arm64 版                |
| ゾーンのネームサーバーは Cloudflare 移行済みのはず | 上記 tunnel が DNS 経由で使えている＝ゾーンが Cloudflare 管理下                                                    | §4.1 は「移行作業」ではなく「確認」に格下げ                     |

#### 1.2.1 `tunnel info` が常に同じ tunnel を返す件

次のように 4 つの名前を順に問い合わせたところ、**4 回とも `shuukatu-back`
（`4e5d1798-...`）が返った**。

```bash
for t in admiral-console job-hunting-agent shuukatu-back yoko-switchbot; do
  echo "== $t"; cloudflared tunnel info "$t"
done
# => NAME: shuukatu-back が 4 回
```

`cloudflared tunnel list` では 4 本が別々の UUID を持っているため、データの異常ではない。

**原因を切り分けた結果、`--config /dev/null` で設定ファイルを無効化すると名前ごとに
正しい tunnel が返ることを確認した。**

```bash
for t in admiral-console job-hunting-agent shuukatu-back yoko-switchbot; do
  echo "== $t"; cloudflared --config /dev/null tunnel info "$t" | head -3
done
```

| 引数に与えた名前    | `--config` なし     | `--config /dev/null` あり                      |
| ------------------- | ------------------- | ---------------------------------------------- |
| `admiral-console`   | `shuukatu-back`     | `admiral-console`（`56959d3c-aadc-...`）       |
| `job-hunting-agent` | `shuukatu-back`     | `job-hunting-agent`（`8522df54-54e8-...`）     |
| `shuukatu-back`     | `shuukatu-back`     | `shuukatu-back`（`4e5d1798-c778-...`）         |
| `yoko-switchbot`    | `shuukatu-back`     | `yoko-switchbot`（`031bebdb-09dd-...`）        |

**確定した事実:**

1. **既定パスの設定ファイルが実在し、その `tunnel:`（= `shuukatu-back`）がコマンドライン引数を
   上書きしている。** othello がこのファイルを上書きしてはならない（§5.2）
2. **`--config` を省いたコマンドは、名前を指定しても `shuukatu-back` を操作する。**
   すべてのコマンドで明示する（§4.2 / §5.2 / §5.5）

なお `--config /dev/null` 使用時に出る
`ERR Configuration file /dev/null was empty` はログ行であり、コマンド自体は正常に完了する
（上表のとおり結果は正しく返る）。無視してよい。

#### 1.2.2 既存の設定ファイル配置

`sudo grep -rn "hostname" /etc/cloudflared/ ~/.cloudflared/` の結果:

| 設定ファイル                       | 公開ホスト名             | 位置づけ                                     |
| ---------------------------------- | ------------------------ | -------------------------------------------- |
| `/etc/cloudflared/config.yml`      | `shuukatsu-back.<domain>` | **既定パス**。§1.2.1 の上書きの原因          |
| `/home/yokochi/.cloudflared/config.yml` | `shuukatsu-back.<domain>` | 既定パス（ユーザー側）。上と同内容           |
| `/etc/cloudflared/switchbot.yml`   | `switchbot.<domain>`     | **tunnel ごとの専用 config。本 Issue が倣う形** |

ここから 3 点が確定した。

1. **`/etc/cloudflared/<tunnel 名>.yml` という運用が既に存在する**（`switchbot.yml`）。
   §5.2 の `othello.yml` はこの既存の流儀に沿ったもので、新しい方式の持ち込みではない
2. 既定パスの config は 2 か所とも `shuukatsu-back` 用に使われている。**触れてはならない**
3. 公開ホスト名は `<サービス名>.<所有ドメイン>` の形で統一されている。
   §2 の `othello.<所有ドメイン>` はこの命名と整合する

#### 1.2.3 既存の systemd 構成

`systemctl list-units` / `systemctl cat 'cloudflared*'` の結果:

| unit                              | ExecStart                                                                                        | 実行ユーザー | Type   | Restart / Sec        | 対応 tunnel        |
| --------------------------------- | ------------------------------------------------------------------------------------------------ | ------------ | ------ | -------------------- | ------------------ |
| `cloudflared.service`             | `/usr/bin/cloudflared --no-autoupdate --config /etc/cloudflared/config.yml tunnel run`           | root（指定なし） | notify | `on-failure` / 15s（drop-in） | `shuukatu-back`    |
| `cloudflared-switchbot.service`   | `/usr/bin/cloudflared --no-autoupdate --config /etc/cloudflared/switchbot.yml tunnel run`        | **yokochi**  | notify | `on-failure` / 10s   | `yoko-switchbot`   |
| `cloudflared-job-hunting.service` | `/usr/local/bin/cloudflared tunnel --config /opt/Procson/.cloudflared/config.yml run job-hunting-agent` | **yokochi**  | simple | `on-failure` / 15s（drop-in） | `job-hunting-agent` |

**確定した事実:**

1. **`cloudflared-<用途>.service` + 専用 config という命名・構成が既に確立している。**
   §5.4 の `cloudflared-othello.service` はこれと完全に一致する
2. `cloudflared-switchbot.service` の ExecStart は §5.4 で設計したものと同形
   （`--no-autoupdate` の付与位置まで含めて）。**既存の書き方をそのまま踏襲すればよい**
3. **cloudflared のバイナリが 2 か所にある**。`/usr/bin/cloudflared`（2 本が使用）と
   `/usr/local/bin/cloudflared`（`job-hunting` が使用）。othello は多数派かつ
   `switchbot` と同じ **`/usr/bin/cloudflared`** を使い、ExecStart に絶対パスで書く
4. `admiral-console` に対応する unit がない。**このホストでは動いていない**
   （`tunnel list` にコネクションがあるのは別ホストから張られているため）。本 Issue とは無関係
5. **cloudflared は非 root（`yokochi`）で動かすのが多数派**（3 本中 2 本）。othello もこれに倣う。
   これは設定ファイル・credentials の所有者にも影響する（§5.4。root:root 600 にすると
   `User=yokochi` のプロセスから読めない）
6. `cloudflared-switchbot.service` には drop-in がなく、安定化設定も入っていない
   （`RestartSec=10s` のみ）。安定化 drop-in は `cloudflared` と `job-hunting` の 2 本にだけ
   後から当てられている。**othello は当てられている側に倣う**（§1.2.3.1）。
   `switchbot` は Webhook 受けで一時的な失敗の影響が小さいのに対し、othello は対局中の
   切断が直接体験を損なうため

#### 1.2.3.1 既存の安定化 drop-in（内容確認済み・othello も踏襲する）

既存 unit には次の drop-in が当てられている。内容を確認したところ、**起動時に DNS が
引けずに tunnel が起動失敗する事象への対処**であることが読み取れる。

`90-yoko-guardian-stability.conf`（`cloudflared` / `cloudflared-job-hunting` の両方に適用）:

```ini
[Unit]
Wants=network-online.target
After=network-online.target nss-lookup.target
StartLimitIntervalSec=300
StartLimitBurst=12

[Service]
Restart=on-failure
RestartSec=15s
TimeoutStartSec=180s
TimeoutStopSec=30s
```

`10-network-retry.conf`（`cloudflared-job-hunting` のみ）:

```ini
[Unit]
Wants=network-online.target
After=network-online.target nss-lookup.target
StartLimitIntervalSec=0

[Service]
ExecStartPre=/usr/local/sbin/yoko-wait-cloudflare-network
Restart=on-failure
RestartSec=15s
TimeoutStartSec=180
```

`/usr/local/sbin/yoko-wait-cloudflare-network` の実体は、`cloudflare.com` が名前解決
できるまで **2 秒間隔で最大 60 回（= 120 秒）待つ** POSIX sh スクリプト。解決できれば
`exit 0`、120 秒で諦めれば日本語メッセージを stderr に出して `exit 1` する。

**この作法から読み取れる設計上の要求:**

| 設定                                   | 意図                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `After=... nss-lookup.target`          | `network-online.target` だけでは DNS が使えない場合がある              |
| `ExecStartPre=yoko-wait-cloudflare-network` | それでも足りず、実際に名前解決できるまで待つ必要があった          |
| `RestartSec=15s`（5s ではなく）        | 短間隔の再起動が有効でなかった。ネットワーク回復を待つ時間が要る       |
| `StartLimitIntervalSec=300` / `Burst=12` | 再起動ループに陥ったときに systemd 側で打ち切る                       |
| `TimeoutStartSec=180s`                 | `ExecStartPre` の最大 120 秒待ちを吸収できる長さ                       |

**othello もこれらを踏襲する**（§5.4）。この環境で実際に踏まれた問題への対処であり、
othello だけ適用しなければ同じ問題を踏み直す。特に §8 確認 10（`reboot` 後の自動起動）で
othello だけが失敗する形で表面化する。

#### 1.2.4 ポート 3000 は使用中

```bash
sudo ss -tlnp | grep -E ':3000\b'
# LISTEN 0 511 *:3000 *:* users:(("node",pid=1887,fd=22))
```

**ポート 3000 は別の Node.js プロセスが使用中**であり、`packages/server` の既定ポートの
ままでは起動できない。

```bash
sudo ss -tlnp | grep -E ':3100\b'
# （出力なし = 空き）
```

**3100 が空いていることを確認済み。othello は 3100 を使う**（§5.3.1）。

このため、本 Issue の実作業は「**5 本目の tunnel を既存のホストへ安全に追加する**」ことに
なる。最大のリスクは新規構築の失敗ではなく、**既存 4 本の tunnel を巻き込んで止めること**
である（§10 リスク 6）。

なお、ホスト名が `yokochi-surver` であり要件定義 §13 の「ラズベリーパイ 1 台。Sebastian と
同居する」と一致するかは要確認（§13 の見直しが必要になる可能性がある）。

### 1.3 Issue 本文の訂正（重要）

Issue #22 の作業内容に「Activity 用パスのみを公開対象とし、`/api/` を公開対象から
除外する設定」とあるが、これは要件定義 §15 と矛盾する。§15 は次のとおり。

> Sebastian 連携用の内部 API（`/internal/`）は localhost からのみ受け付け、
> Cloudflare Tunnel の公開対象に含めない。Activity 向けの `/api/`（OAuth トークン交換等）は
> iframe から Discord プロキシ経由でアクセスされるため Tunnel で公開する

`/api/token` は M2-4 で実装済みの OAuth2 トークン交換エンドポイントであり、
Activity の iframe から Discord プロキシ（`/.proxy/api/token`）経由で必ず呼ばれる。
これを遮断すると Activity が認証できず M2-4 が機能しなくなる。

**本設計では要件定義 §15 を正とし、「`/api/` は公開・`/internal/` を遮断」で設計する。**
Issue 本文のチェックリストは以下に読み替える。

- [ ] Activity 用パス（`/`、`/api/`、後続の `/ws`）を公開対象とし、`/internal/` を公開対象から除外する設定

---

## 2. 決定事項（O-07: サブドメイン名）

O-07「割り当てるサブドメイン名」は M2 が決定期限の未決事項であり、本 Issue で確定させる。

| 候補       | 例                     | 評価                                                                                     |
| ---------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| `othello`  | `othello.example.com`  | 用途が一目で分かる。将来ドメイン内に別サービスが増えても衝突しにくい（推奨）             |
| `game`     | `game.example.com`     | 汎用的すぎ、他のゲームを足すときに取り合いになる                                         |
| `activity` | `activity.example.com` | Discord Activity 以外の用途に使えず、意味が狭い                                          |

**決定案: `othello.<所有ドメイン>`**（ユーザー確認待ち。確定後、本節と要件定義 §20 O-07 を更新する）

### 2.1 既存の割当との衝突確認（**確認済み・未使用**）

```bash
dig +short othello.example.com
# （出力なし = 未使用）
```

`othello.<所有ドメイン>` は**未使用であることを確認済み**。O-07 は `othello` で確定できる。
以下は確認手順の記録。


既に 4 本の tunnel が同一ゾーンにサブドメインを持っている。決定前に衝突がないことを
確認する。

なお `cloudflared tunnel info <name>` は**ホスト名を表示しない**（コネクタの状態を表示する
コマンドであり、そもそも既定設定に引きずられて別 tunnel を返す。§1.2.1）。
ホスト名の確認には次を使う。

```bash
# 1) 割当先が未使用であること（何も返らなければ未使用）
dig +short othello.example.com

# 2) 既存 tunnel が公開しているホスト名を設定ファイルから拾う
sudo grep -rn "hostname" /etc/cloudflared/ ~/.cloudflared/ 2>/dev/null
```

3. Cloudflare ダッシュボード → 対象ゾーン → **DNS → Records** で、
   `*.cfargotunnel.com` を向く CNAME の一覧を確認する（これが最も確実）

### 2.2 tunnel 名の命名

サブドメイン名とは別に、tunnel 自体の名前も決める。既存は
`admiral-console` / `job-hunting-agent` / `shuukatu-back` / `yoko-switchbot` と
**用途を表すケバブケース**で統一されている。これに倣い **`othello`**（または他の個人用途と
揃えるなら `yoko-othello`）とする。`cloudflared tunnel list` 上で一目で判別できることが
選定基準。

なお既存では **tunnel 名・ホスト名・設定ファイル名が厳密には一致していない**
（tunnel `yoko-switchbot` → ホスト `switchbot.<domain>` → 設定 `switchbot.yml`。
tunnel `shuukatu-back` → ホスト `shuukatsu-back.<domain>`）。othello は 3 つとも
`othello` で揃え、取り違えの余地をなくす。

以降、本書では所有ドメインを `example.com`、割当先を `othello.example.com`、
tunnel 名を `othello` と表記する。
実際の作業では自分のドメインへ読み替えること。ドメイン名そのものはリポジトリに
コミットせず、環境変数・ラズパイ上の設定ファイルにのみ置く（§7.2）。

---

## 3. 全体構成

```
  Discord クライアント（iframe 内の Activity）
        │  fetch("/.proxy/api/token") / WebSocket
        ▼
  Discord プロキシ（/.proxy を剥がして転送）
        │  https://othello.example.com/api/token
        ▼
  Cloudflare エッジ（TLS 終端・証明書自動）
        │  Tunnel（ラズパイからの外向き接続のみ。ポート開放なし）
        ▼
  ラズパイ
   ├ cloudflared.service   ingress ルールでパスを振り分ける
   │        │ http://127.0.0.1:3100
   │        ▼
   ├ othello.service       オセロサーバー（127.0.0.1:3100 のみで待ち受け）
   │        ▲
   │        │ http://127.0.0.1:3100/internal/...（Tunnel を通らない）
   └ sebastian.service     Sebastian（Python）
```

要点は次の 3 つ。

1. ラズパイからの**外向き**接続だけで公開が成立するため、ルータのポート開放は不要（§13）
2. オセロサーバーは `127.0.0.1` のみで待ち受け、外部到達経路を cloudflared に一本化する
3. `/internal/` は cloudflared の ingress で遮断し、さらにサーバー側でも接続元を検証する（多層防御）

---

## 4. Cloudflare 側の設定

### 4.1 ネームサーバー移行（**確認済み・作業不要**）

Tunnel の DNS レコード（CNAME）を作るには、対象ゾーンの権威 DNS が Cloudflare である
必要がある。**確認の結果、移行は完了済みだった。**

```bash
dig +short NS example.com
# kate.ns.cloudflare.com.
# giancarlo.ns.cloudflare.com.
```

Cloudflare のネームサーバー 2 台が返っており、ゾーンは Cloudflare 管理下にある。
**本 Issue でネームサーバーに関する作業は発生しない**（したがって §10 リスク 8 の
「メール系レコードの取りこぼし」も該当しない）。§4.2 へ進んでよい。

<details>
<summary>未移行だった場合の手順（該当しなければ読み飛ばす）</summary>

**メール（MX / SPF / DKIM / DMARC）を設定している場合、移行漏れは受信断に直結するため、
必ず移行前に現行レコードを控える。**

1. 現行 DNS の全レコードを控える（レジストラの管理画面のエクスポート、または `dig`）

   ```bash
   for t in A AAAA CNAME MX TXT NS SRV CAA; do
     echo "== $t"; dig +short "$t" example.com
   done
   dig +short TXT _dmarc.example.com
   ```

2. Cloudflare にゾーン `example.com` を追加する（Free プラン）
3. Cloudflare が自動取り込みしたレコード一覧と、手順 1 の控えを**1 行ずつ突き合わせる**
   （自動取り込みは MX・TXT・サブドメインを取りこぼすことがある）
4. レジストラでネームサーバーを Cloudflare の 2 台に変更する
5. ゾーンが Active になるまで待つ（数分〜48 時間）。反映確認:

   ```bash
   dig +short NS example.com
   ```

6. 既存サービス（Web・メール）が移行後も従来どおり動くことを確認する

| 確認項目            | 確認方法                                                             |
| ------------------- | -------------------------------------------------------------------- |
| 既存 Web サイトの表示 | ブラウザで従来 URL を開く                                            |
| メール受信          | 外部アドレスからテスト送信する                                       |
| メール送信の認証    | SPF / DKIM / DMARC の TXT が移行済みか `dig TXT` で確認              |
| プロキシ設定        | 既存レコードのオレンジ雲（プロキシ）有無が移行前の意図と合っているか |

</details>

### 4.2 Tunnel の作成と DNS 割当

quick tunnel（M2-3 で使った `trycloudflare.com`）は起動のたびに URL が変わるため本番では
使えない。**named tunnel** を作成する。

`cloudflared tunnel login` は既存 tunnel の構築時に実行済みで `~/.cloudflared/cert.pem` が
あるため、**本 Issue では不要**（再実行すると cert.pem を上書きするので実行しない）。

既定パスの設定ファイルが引数を上書きするため（§1.2.1）、**`--config /dev/null` を付けて
設定ファイルを無効化した状態で実行する**。特に `tunnel route dns` は、上書きされると
`othello.example.com` の CNAME を**既存の別 tunnel へ向けてしまう**。

```bash
# サーバー上で実行
cloudflared --config /dev/null tunnel create othello   # Tunnel と credentials JSON を作成
cloudflared --config /dev/null tunnel list             # 5 本目として現れる。UUID を控える

# ゾーンに CNAME（othello.example.com -> <新 UUID>.cfargotunnel.com）を作る
cloudflared --config /dev/null tunnel route dns othello othello.example.com
# INF Added CNAME othello.example.com which will route to this tunnel tunnelID=<UUID>
```

- `cloudflared tunnel create` は `~/.cloudflared/<UUID>.json`（credentials）を作る
- `cert.pem` と `<UUID>.json` はいずれも機密。**リポジトリには置かない**（§7.2）
- `tunnel route dns` は既存レコードがあると失敗する。§2.1 の衝突確認を先に済ませておく
- **`tunnel create` は名前のタイプミスを検出しない。** 打ち間違えるとその綴りで tunnel が
  作られる。`tunnel list` で綴りを確認し、誤っていれば
  `tunnel delete <誤名>` と credentials の削除をしてから作り直す

#### 4.2.1 割当先の検証（`dig CNAME` では確認できない）

`tunnel route dns` が作る CNAME は**プロキシ有効（オレンジ雲）**で作られる。
プロキシ済みレコードは権威 DNS が CNAME をそのまま返さず Cloudflare エッジの
A/AAAA に置き換えて応答するため、**`dig +short CNAME <ホスト名>` は空を返す**。
これは異常ではない。

| 確認したいこと           | 方法                                                                       |
| ------------------------ | -------------------------------------------------------------------------- |
| tunnel との対応（最重要） | `route dns` の出力の `tunnelID=<UUID>` が、作成した tunnel の UUID と一致するか |
| レコードの実体           | Cloudflare ダッシュボード → DNS → Records（`<UUID>.cfargotunnel.com` を向く CNAME） |
| 名前解決できるか         | `dig +short othello.example.com @1.1.1.1` → Cloudflare のアドレスが返る    |

割当前に未使用確認（§2.1）で引いていると NXDOMAIN がリゾルバにネガティブキャッシュされ、
しばらく空応答が続くことがある。`@1.1.1.1` を指定するか時間を置いて引き直す。

---

## 5. ラズパイ側の設定

### 5.1 cloudflared のバージョン（導入は済み）

`cloudflared` は導入済み（**v2026.7.2**）で、起動時に「v2026.8.3 が出ている」という警告が
出る状態。本 Issue では次のように扱う。

**更新は本 Issue の必須作業に含めない。** 理由は、5 本目の tunnel を追加する作業と
バイナリ更新を同時に行うと、問題が起きたときにどちらが原因か切り分けられなくなるため。
既存 4 本が現行バージョンで安定稼働している以上、更新は独立した作業として扱う。

順序は次のとおり。

1. 本 Issue（othello tunnel の追加）を現行 v2026.7.2 のまま完了させる
2. 動作確認（§8）が通ってから、必要なら別途バージョンを更新する

更新する場合の手順（参考。実行時は既存 4 本のダウンタイムを許容できる時間帯に行う）:

```bash
cloudflared --version                     # 更新前のバージョンを控える
sudo cloudflared update                   # またはパッケージを入れ直す
sudo systemctl restart 'cloudflared*'     # 全 tunnel が再接続する
cloudflared tunnel list                   # 5 本すべて CONNECTIONS が復活しているか
```

（新規に導入するホストで作業する場合のみ、`uname -m` が `aarch64` なら arm64、`armv7l` なら
armhf の `.deb` を使う。）

### 5.2 ingress ルール（公開範囲の設計）

**設定ファイルは `/etc/cloudflared/config.yml` を使わない。** 既定パスは `shuukatsu-back`
が使用中であることを確認済みで、上書きすれば既存 tunnel を壊す（§1.2.2 / §5.5）。
othello 専用に `/etc/cloudflared/othello.yml` を作る（root 所有・パーミッション 600）。
これは既存の `/etc/cloudflared/switchbot.yml` と同じ「tunnel ごとの専用 config」方式で、
新しい方式の持ち込みではない。

既存の `switchbot.yml` に合わせ、**`tunnel:` は名前ではなく UUID**、インデントは 2 スペース、
`originRequest` は使わない形にする。

```yaml
tunnel: <UUID>
# credentials は tunnel create が作った場所をそのまま指す（§5.4。コピーしない）
credentials-file: /home/yokochi/.cloudflared/<UUID>.json

# 上から順に評価され、最初に一致したルールが使われる。
# 遮断したいパスほど先に書く（要件定義 §15）
ingress:
  # 1) Sebastian 連携用の内部 API は公開しない（localhost からのみ使う）
  - hostname: othello.example.com
    path: ^/internal(/.*)?$
    service: http_status:404

  # 2) Activity 用のパス（静的配信 / OAuth トークン交換 / 後続の WebSocket）
  - hostname: othello.example.com
    service: http://127.0.0.1:3100

  # 3) それ以外のホスト名で来たリクエストは落とす（catch-all は必須）
  - service: http_status:404
```

**`service:` は `localhost` ではなく `127.0.0.1` と書く。** オセロサーバーは
`HOST=127.0.0.1` で IPv4 のみ待ち受けるため（§5.3）、`localhost` が `::1` に解決されると
接続が拒否される。既存の `switchbot.yml` は `http://localhost:8766` と書いているが、
そちらのアプリが両スタックで待ち受けているためであり、othello では明示する。

#### 5.2.1 設定ファイルの作り方

`cloudflared` に設定ファイルを生成するコマンドはない。**エディタで直接書く**
（既存の `switchbot.yml` も同様と思われる）。

「`~/.cloudflared/config.yml` が `/etc/cloudflared/` にコピーされる」という記事は
`cloudflared service install` の挙動の説明であり、本 Issue では使わない（§5.5）。

```bash
# ヒアドキュメントで作る（内容を一度に貼れるので取りこぼしが起きにくい）
sudo tee /etc/cloudflared/othello.yml >/dev/null <<'EOF'
（上記の内容）
EOF

# 既存 2 本と同じ権限に揃える（§5.4）
sudo chown root:root /etc/cloudflared/othello.yml
sudo chmod 644 /etc/cloudflared/othello.yml
```

`sudo nano /etc/cloudflared/othello.yml` で書いてもよい。どちらの場合も、作成後に
権限を揃え、下記の検証を行う。

設計上の判断:

| 判断                                          | 理由                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| `/internal/` は 403 でなく 404 を返す         | 内部 API の存在自体を外部に示さない                                                    |
| `path` を `^/internal(/.*)?$` の正規表現にする | `path` は正規表現マッチ。`/internal` 単体と配下の両方を塞ぐ                            |
| `/api/` を許可ルールに含める                  | Activity が Discord プロキシ経由で `/api/token` を呼ぶ（§1.2）                         |
| 末尾に catch-all の 404 を置く                | ingress の最後は catch-all が必須（設定検証でエラーになる）                            |
| WebSocket 用の個別ルールを書かない            | cloudflared は HTTP サービスへの Upgrade をそのまま中継する。M3 の `/ws` は 2) に含まれる |

設定の妥当性検証（**必ず `--config` で othello の設定を指定する**。省略すると既定パスの
設定＝別 tunnel の設定を検証してしまう）:

```bash
cloudflared --config /etc/cloudflared/othello.yml tunnel ingress validate
cloudflared --config /etc/cloudflared/othello.yml tunnel ingress rule \
  https://othello.example.com/api/token      # -> http://127.0.0.1:3100
cloudflared --config /etc/cloudflared/othello.yml tunnel ingress rule \
  https://othello.example.com/internal/x     # -> http_status:404
```

### 5.3 サーバー側の待ち受けアドレス

現状 `packages/server/src/env.ts` の `DEFAULT_HOST` は `0.0.0.0` で、LAN 内の他端末からも
到達できる。Tunnel 公開後は外部到達経路を cloudflared に一本化するため、**本番では
`HOST=127.0.0.1` を明示的に設定する**（コードの既定値は開発時の利便性のため変更しない）。

これにより `/internal/` は「cloudflared の ingress で 404」＋「LAN からも到達できない」の
二重で保護される。

### 5.3.1 待ち受けポート（3000 は使用不可）

`packages/server` の既定ポートは 3000 だが、**このホストでは別の Node.js プロセスが
3000 を使用中**（§1.2.4）。既定のまま起動すると `EADDRINUSE` で起動に失敗する。

**othello の本番ポートは `3100` とする**（`othello.service` の `Environment=PORT=3100`）。
コードの既定値（`env.ts` の `DEFAULT_PORT = 3000`）は開発環境用に変更しない。要件定義 §16.2
「ポートは環境変数で外部化する」に沿い、環境変数だけで解決する。

割当前に空きを確認する:

```bash
sudo ss -tlnp | grep -E ':3100\b'   # 何も返らなければ空き
```

埋まっていた場合は 3101、3102 … と空きを探す。決めたポートは次の 3 か所で一致させる。

| 箇所                          | 設定                                          |
| ----------------------------- | --------------------------------------------- |
| `othello.service`             | `Environment=PORT=3100`                       |
| `/etc/cloudflared/othello.yml` | `service: http://127.0.0.1:3100`              |
| §8 の動作確認                 | `curl http://127.0.0.1:3100/`                 |

開発機の `packages/client/vite.config.ts` の `API_TARGET`（`http://localhost:3000`）は
**開発機上の話であり、変更不要**。ラズパイ上のポートとは無関係。

### 5.4 systemd サービス

要件定義 §16.2 に従い、cloudflared とオセロサーバーの両方を systemd 常駐にする。
`sebastian.service` に倣い `Restart=always` とし、標準出力がバッファリングで失われない
ようにする。

**cloudflared**: `sudo cloudflared service install` は**実行しない**。既定パスの設定を前提に
`cloudflared.service` を作る／上書きするコマンドであり、これは既に `shuukatu-back` が
使用中である（§1.2.3）。othello 専用の unit を手で作る。

othello 用の unit は、既存の `cloudflared-switchbot.service`（§1.2.3）と同じ形にしてある。
新しい書き方の持ち込みではなく、**このホストで既に確立している流儀の踏襲**である。

**credentials は `/etc/cloudflared/` にコピーしない。** 既存の配置を確認した結果、
このホストでは次の使い分けになっている。

```
/etc/cloudflared/config.yml      -rw-r--r-- root root   # 設定のみ。秘密情報なし
/etc/cloudflared/switchbot.yml   -rw-r--r-- root root   # 同上
~/.cloudflared/<UUID>.json       -r-------- yokochi     # credentials（秘密）
```

**設定ファイル（`.yml`）は `root:root 644`、credentials はホーム配下に `400` のまま**
という分担で、これは理にかなっている。

- `.yml` に秘密情報は入らない（tunnel 名・credentials のパス・ingress ルール・
  localhost のポートのみ）。root 所有で編集を保護しつつ、誰でも読める 644 で問題ない
- 秘密は credentials の JSON だけで、これは `yokochi` のみ読める `400`。
  `User=yokochi` で動く cloudflared から読める（§1.2.3 の 5）

したがって othello も同じ形にする。`cloudflared tunnel create` が
`~/.cloudflared/<UUID>.json` を 400 で作るので、**credentials に対する追加作業は不要**。

```bash
# 設定ファイルだけを /etc/cloudflared に置く（既存 2 本と同じ権限に揃える）
sudo chown root:root /etc/cloudflared/othello.yml
sudo chmod 644 /etc/cloudflared/othello.yml

# credentials は移動もコピーもしない。権限だけ確認する
ls -l ~/.cloudflared/<UUID>.json    # -r-------- yokochi yokochi
```

unit ファイルの実体は**リポジトリの `deploy/systemd/` に置く**（§7.1）。本書では内容を
再掲せず、配置と設計意図だけを記す。実機へはコピーで反映する（§5.4.1）。

| リポジトリ内のファイル                       | 配置先                                            | 対応              |
| -------------------------------------------- | ------------------------------------------------- | ----------------- |
| `deploy/systemd/cloudflared-othello.service` | `/etc/systemd/system/cloudflared-othello.service` | Tunnel            |
| `deploy/systemd/othello.service`             | `/etc/systemd/system/othello.service`             | オセロサーバー    |

`cloudflared-othello.service` は `cloudflared.service` の本体と同形で、安定化の設定は
§1.2.3.1 の作法をそのまま取り込んである。

既存は「素の unit + drop-in」の二段構えだが、othello は**新規に作る unit のため
最初から本体に書き込む**（drop-in は既存 unit を後から直すための仕組みであり、
新規ファイルで同じ二段構えにする必要はない）。

既存との対応:

| 設定                                        | 由来                                                      |
| ------------------------------------------- | --------------------------------------------------------- |
| `ExecStart=/usr/bin/cloudflared --no-autoupdate --config ... tunnel run` | `cloudflared-switchbot.service` と同形（§1.2.3） |
| `Type=notify`                               | `cloudflared.service` / `cloudflared-switchbot.service` に倣う |
| `User=yokochi`                              | `cloudflared-switchbot.service` に倣う（非 root が多数派）。設定ファイルの所有者もこれに合わせる |
| `After=... nss-lookup.target` / StartLimit / `RestartSec=15s` / Timeout 各種 | `90-yoko-guardian-stability.conf`（§1.2.3.1） |
| `ExecStartPre=yoko-wait-cloudflare-network` | `10-network-retry.conf`（§1.2.3.1）                       |

実機への配置と有効化の手順は §5.4.1 にまとめる。

`--no-autoupdate` を付けるのは、プロセスが勝手に自己更新して再起動する挙動を避け、
バージョン更新を §5.1 の計画的な作業に限定するため。既存の `cloudflared.service` /
`cloudflared-switchbot.service` も同じ指定になっている（§1.2.3）。

`Restart` を `always` ではなく **`on-failure`** にしているのは、このホストの
cloudflared 系 3 本すべてが `on-failure` で運用されているため（§1.2.3.1）。
cloudflared は tunnel の切断を自プロセス内で再接続するので、プロセスが正常終了するのは
`systemctl stop` などの意図的な停止時に限られ、`on-failure` で E-13 に対応できる。

**オセロサーバー**（`deploy/systemd/othello.service` → `/etc/systemd/system/othello.service`）。
設計上の判断は次のとおり。

- `User=yokochi`: 既存の `cloudflared-job-hunting.service` と同じ実行ユーザー（§1.2.3）
- `Restart=always`: 要件定義 §16.2「`sebastian.service` に倣い `Restart=always`」に従う。
  cloudflared 側を `on-failure` にしたのとは意図的に使い分けている（tunnel は自プロセスで
  再接続するが、オセロサーバーは異常終了以外でも上がっていてほしい）
- `RestartSec=15s`: このホストの作法に合わせる（§1.2.3.1）
- `StartLimit*` は付けない。`Restart=always` と併用すると設定不備（環境変数未設定など）で
  起動失敗が続いたときに systemd が諦めてしまうため、`journalctl` で気づけるようにする
- `WorkingDirectory=/opt/Discord_Othello/packages/server`: **サーバー上のリポジトリは
  `/opt/Discord_Othello` に配置済みであることを確認済み**。既存の
  `/opt/Procson/job-hunting-agent`（§1.2.3）と同じく `/opt` 配下に置く流儀と一致する
- `ExecStart` が参照する `dist/index.js` は `npm run build` の成果物。
  デプロイ時にビルド済みであることが前提（要件定義 §16.3）

`/etc/othello/othello.env` に `DISCORD_CLIENT_ID` と `DISCORD_CLIENT_SECRET` を置く
（§13 / §15）。**所有者は `yokochi:yokochi`・パーミッション 600** にする。

```bash
sudo mkdir -p /etc/othello
sudo chown yokochi:yokochi /etc/othello/othello.env
sudo chmod 600 /etc/othello/othello.env
```

`EnvironmentFile` は systemd（root）が読んでプロセスに渡すため root 所有でも起動はするが、
所有者を実行ユーザーに揃えておけば、`sudo` なしで内容を確認・更新できて運用が楽になる。
どちらでも 600 は維持し、他ユーザーから読めない状態にする。

**クライアント側には別に `packages/client/.env` が要る（`VITE_DISCORD_CLIENT_ID`）。**
`packages/client/src/env.ts` は `VITE_DISCORD_CLIENT_ID` を必須にしており、Vite は
`VITE_` 接頭辞の変数を**ビルド時にバンドルへ埋め込む**。実行時に読む値ではないため、
`othello.env`（サーバープロセス用）では代替できない。

| ファイル                     | 読む主体             | タイミング   | 内容                                            |
| ---------------------------- | -------------------- | ------------ | ----------------------------------------------- |
| `/etc/othello/othello.env`   | `othello.service`    | サーバー実行時 | `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`  |
| `packages/client/.env`       | Vite（`npm run build`） | クライアントのビルド時 | `VITE_DISCORD_CLIENT_ID`                |

```bash
# ラズパイ上で、ビルドの前に用意する
printf 'VITE_DISCORD_CLIENT_ID=%s\n' '<Client ID>' > /opt/Discord_Othello/packages/client/.env
```

- **未設定でもビルドは成功する。** Activity を開いた時点でクライアントが例外を投げるため、
  §8 の確認 8 まで気づけない。ビルド前に必ず用意する
- Client ID はクライアントへ埋め込まれる前提の値であり秘密ではない。`othello.env` の
  `DISCORD_CLIENT_SECRET`（サーバー限定・600）とは扱いが異なる
- `.env` は `.gitignore` 済み（§7.2）。リポジトリからは配布されないので、**ラズパイ上で作る**
- Client ID を変更したら、`.env` を直したうえで**クライアントを再ビルドする**必要がある
  （サーバーの再起動だけでは反映されない）

`cloudflared-othello` と `othello` の間に起動順序の依存は張らない。cloudflared が先に
上がってもオリジン未起動なら 502 を返すだけで、双方の `Restart` により自然に整合する（E-13）。

#### 5.4.1 実機への反映（コピーで行う）

リポジトリの `deploy/systemd/` に置いた 2 ファイルを `/etc/systemd/system/` へ**コピー**する。

前提として、**ラズパイ上でビルドと 2 つの環境変数ファイルの用意が済んでいること**（§5.4）。
`othello.service` は `dist/index.js` を直接起動するため、ビルド前に `enable --now` すると
`MODULE_NOT_FOUND` で起動に失敗し、`Restart=always` により再起動を繰り返す。

```bash
cd /opt/Discord_Othello
npm ci          # devDependencies（TypeScript / Vite）が要る。NODE_ENV=production では入らない
npm run build   # packages/server/dist と packages/client/dist の両方を作る
ls -l packages/server/dist/index.js packages/client/dist/index.html
```

シンボリックリンク（`systemctl link` や、リポジトリ内の絶対パスを指定した
`systemctl enable`）は使わない。`git pull` / `git checkout` でユニットの実体が黙って
入れ替わるうえ、`daemon-reload` は自動では走らないためである。既存 4 本の tunnel と
同居するホストでは、リポジトリの状態が systemd に即座に波及しないほうが安全である
（§10 リスク 1）。

```bash
sudo install -m 644 -o root -g root \
  /opt/Discord_Othello/deploy/systemd/cloudflared-othello.service \
  /opt/Discord_Othello/deploy/systemd/othello.service \
  /etc/systemd/system/

# 構文と参照先の検証（エラーが出なければよい）
systemd-analyze verify /etc/systemd/system/cloudflared-othello.service \
                       /etc/systemd/system/othello.service

sudo systemctl daemon-reload
sudo systemctl enable --now othello
sudo systemctl enable --now cloudflared-othello
systemctl status othello cloudflared-othello
```

- 起動順序に依存はないが、先に `othello` を上げておくと §8 の確認 4 で 502 を見ずに済む
- **リポジトリ側の unit を変更したら、必ず再度コピーして `daemon-reload` する。**
  コピーを忘れると編集が反映されず、原因の分かりにくい不整合になる（§9）
- `systemd-analyze verify` はラズパイ上でのみ実行できる。開発機（Windows）では検証できない
- `enable --now` の対象名を打ち間違えないこと。`cloudflared`（既存の `shuukatu-back` 用）と
  `cloudflared-othello` は別のサービスである（§5.5）

### 5.5 既存 4 本の tunnel との共存（重要）

同一ホストで 5 本目の tunnel を動かすうえでの原則。**既存 4 本の設定・プロセスには
一切触れない**。

| 禁止・注意事項                              | 理由                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `sudo cloudflared service install` を実行しない | 既定パスの設定を前提に `cloudflared.service` を作成／上書きする。既存の運用形態を壊し得る       |
| `cloudflared tunnel login` を再実行しない   | `~/.cloudflared/cert.pem` を上書きする                                                           |
| 既定パスの設定ファイルを書き換えない        | **既存 tunnel が使っていることを確認済み**（§1.2.1）。othello は `othello.yml` を使う（§5.2）    |
| コマンドは常に `--config` を明示する        | **既定パスの設定が引数より優先されることを確認済み**（§1.2.1）。省略すると別 tunnel を操作する   |
| `systemctl restart cloudflared` を打たない  | othello 用は `cloudflared-othello`。名前を取り違えると無関係のサービスを落とす                   |
| ポート番号を既存と衝突させない              | **3000 は使用中であることを確認済み**（§1.2.4）。othello は 3100 を使う（§5.3.1）               |
| バイナリは `/usr/bin/cloudflared` を使う    | `/usr/local/bin/cloudflared` は `job-hunting` 用。ExecStart に絶対パスで書く（§1.2.3）          |

作業前に既存構成を把握しておく:

```bash
# 既存の cloudflared 系サービスの一覧と、それぞれが読む設定ファイル
systemctl list-units --type=service | grep -i cloudflared
systemctl cat 'cloudflared*' | grep -E "^#|ExecStart"
ls -l /etc/cloudflared/ ~/.cloudflared/

# othello 用に使うポートが空いているか（3000 は使用中。§1.2.4）
sudo ss -tlnp | grep -E ':3100\b'
```

作業後、**既存 4 本の CONNECTIONS が維持されていること**を必ず確認する（§8 確認 11）。

---

## 6. Discord 側の設定変更

Developer Portal の **Activities → URL Mappings** を、M2-3 で設定した
`<ランダム>.trycloudflare.com` から本番ホストへ変更する。

| prefix | target                |
| ------ | --------------------- |
| `/`    | `othello.example.com` |

開発時に quick tunnel へ戻す運用では、URL Mapping を都度書き換えることになる。
開発用と本番用で Discord アプリケーションを分ければ切り替えは不要になるが、
本 Issue のスコープ外とし、煩わしさが実際に問題になった時点で判断する。

---

## 7. リポジトリ側の変更

### 7.1 変更するファイル

| ファイル                            | 変更内容                                                                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/client/vite.config.ts`    | `allowedHosts` のコメント「実際のサブドメインは #20 / #22 で確定させる」を、確定済みである旨に更新する。開発サーバーは本番ホストで待ち受けないため、本番ホストの追加は**不要** |
| `deploy/systemd/cloudflared-othello.service` | **新規**。Tunnel 用の systemd unit（§5.4）。実機へはコピーで反映する（§5.4.1）                                                                          |
| `deploy/systemd/othello.service`    | **新規**。オセロサーバー用の systemd unit（§5.4）。同上                                                                                                          |
| `docs/m2-5-cloudflare-tunnel.md`    | 本書                                                                                                                                                            |
| `要件定義.md` §20 O-07              | サブドメイン名の決定内容を反映して未決事項から外す                                                                                                              |

アプリケーションコードの変更はない。本 Issue は主にラズパイ・Cloudflare・Discord 側の
設定作業であり、リポジトリ側は unit ファイルの管理とドキュメントの更新にとどまる。

unit をリポジトリで管理するのは、本書に書いた内容と実機のファイルが乖離するのを防ぎ、
変更履歴を git に残すためである。したがって §5.4 では unit の内容を再掲せず、
**実体は `deploy/systemd/` の 2 ファイルに一本化している**。

配置先を `deploy/` としたのは、リポジトリ直下が monorepo の設定ファイル置き場
（`package.json` / `tsconfig.base.json` / `eslint.config.js`）であり、運用ファイルを
混在させないため。ファイル名は実機での unit 名と一致させる。名前が食い違うと
§5.5 の「サービス名の取り違え」を自ら誘発する。

### 7.2 リポジトリに含めないもの（§13 / §15）

- `~/.cloudflared/cert.pem`、`<UUID>.json`（Tunnel の資格情報）
- `/etc/cloudflared/config.yml`（実ドメイン名を含む）
- `/etc/othello/othello.env`（OAuth 資格情報）
- `packages/client/.env`（`VITE_DISCORD_CLIENT_ID`。秘密ではないが環境ごとの値であり、
  ラズパイ上で作る。§5.4）
- 実際のドメイン名・サブドメイン名（ドキュメント中は `example.com` 表記で通す）

`.gitignore` は既に `.env` / `.env.*`（`.env.example` を除く）を除外済みで、
上記はいずれもリポジトリ外に置くため追加の除外設定は不要。

`deploy/systemd/` の unit ファイルは**機密を含まないためコミットしてよい**。実ドメイン名は
`othello.yml` 側、OAuth 資格情報は `othello.env` 側にあり、unit はそれらのパスを指すだけで
ある。`User=yokochi` や `/opt/Discord_Othello` などのホスト固有値は残るが、これらは秘密では
なく、デプロイ先が要件定義 §13 のラズパイ 1 台に固定されているため、プレースホルダ化せず
実値のまま置く（置換忘れによる事故の余地をなくす）。

---

## 8. 動作確認手順

ラズパイ上にビルド済みの成果物を配置し、両サービスを起動した状態で行う。

| #   | 確認内容                        | 手順                                                                                                              | 期待結果                                                   |
| --- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | 名前解決                        | `dig +short othello.example.com @1.1.1.1`（CNAME ではなく A で確認。§4.2.1）                                      | Cloudflare のアドレスが返る                                |
| 2   | 静的配信                        | `curl -I https://othello.example.com/`                                                                            | 200、`Content-Type: text/html`                             |
| 3   | TLS                             | ブラウザで開く                                                                                                    | 証明書エラーが出ない                                       |
| 4   | `/api/` が公開されている        | `curl -i -X POST https://othello.example.com/api/token -H "Content-Type: application/json" -d "{}"`                | 400（`code が指定されていません`）＝オリジンに到達している |
| 5   | `/internal/` が遮断されている   | `curl -i https://othello.example.com/internal/ping`                                                               | **404**。かつオリジンに到達していないこと                  |
| 6   | `/internal/` は localhost から可 | サーバー上で `curl -i http://127.0.0.1:3100/internal/ping`                                                        | Tunnel を経由せず到達する（実装は後続 Issue）              |
| 7   | LAN から直接叩けない            | 別端末から `curl http://<サーバーの LAN IP>:3100/`                                                                | 接続拒否（`HOST=127.0.0.1` の効果）                        |
| 8   | Activity 起動                   | Discord のボイスチャンネルから Activity を起動                                                                    | 初期画面が iframe 内に表示され、OAuth2 認証が通る          |
| 9   | 再起動耐性（E-13）              | `sudo systemctl restart cloudflared`                                                                              | 数秒で復旧し、再読み込みで Activity が動く                 |
| 10  | 自動起動                        | `sudo reboot`                                                                                                     | 再起動後、手動操作なしで 2 と 8 が成立する                 |
| 11  | **既存 tunnel への無影響**      | `cloudflared tunnel list`                                                                                         | 既存 4 本の CONNECTIONS が作業前と同様に張られている       |
| 12  | 既存サービスの疎通              | 既存 4 本が公開しているサービスに実際にアクセスする                                                               | 作業前と同じく利用できる                                   |

確認 8 で画面が表示されない・iframe 内で例外になる場合は、`VITE_DISCORD_CLIENT_ID` を
設定せずにクライアントをビルドした可能性を疑う（§5.4）。ビルドは成功してしまうため、
この確認まで発覚しない。

確認 5 は本 Issue の要になる。**404 がオリジン由来ではなく ingress 由来であること**を、
`journalctl -u othello` に該当リクエストが記録されていないことで確かめる。

確認 11・12 は既存環境への追加作業であることに由来する（§1.2 / §5.5）。作業直後だけでなく、
確認 10 の再起動後にも実施する。

---

## 9. 異常系・運用

| 事象                       | 対応                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| E-13 Tunnel が切断した     | `Restart=always` で cloudflared が再接続する。復旧後にクライアントが再接続すれば対局は継続する |
| オリジン未起動時のアクセス | Cloudflare が 502 を返す。`journalctl -u cloudflared-othello` に接続エラーが出る           |
| 設定変更の反映             | `othello.yml` 変更後は `sudo systemctl restart cloudflared-othello`（`cloudflared` 単体を再起動しない。§5.5） |
| unit を変更した            | リポジトリの `deploy/systemd/` を直し、`/etc/systemd/system/` へコピー → `daemon-reload` → 該当サービスを restart（§5.4.1）。実機を直接編集しない（次回コピーで上書きされる） |
| ログ確認                   | `journalctl -u cloudflared-othello -f` / `journalctl -u othello -f`                        |
| Tunnel の状態確認          | `cloudflared tunnel info othello`、ダッシュボードの Zero Trust → Networks → Tunnels        |

---

## 10. リスク

| #   | リスク                                     | 影響                       | 対策                                                                                             |
| --- | ------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | **既存 4 本の tunnel を巻き込んで停止させる** | 他サービスが全断           | §5.5 の禁止事項を守る（`service install` を打たない・専用 config と専用 unit・`--config` 明示）。§8 確認 11・12 で無影響を検証する（**本 Issue の最大リスク**） |
| 2   | ポート番号の衝突                           | othello が `EADDRINUSE` で起動しない | **3000 は使用中を確認済み**。3100 を使い、割当前に `ss -tlnp` で空きを再確認する（§1.2.4 / §5.3.1） |
| 3   | ingress の `path` 正規表現の書き損じ       | `/internal/` が外部公開される | `cloudflared tunnel ingress rule` で検証し、§8 の確認 5 を必ず実施する                           |
| 4   | 認証情報（`cert.pem` / credentials）の破壊 | 既存 tunnel の再構築が必要 | `tunnel login` を再実行しない。credentials は tunnel 名が分かる名前で配置する（§5.4）           |
| 5   | サーバー上の credentials 流出              | Tunnel を第三者に張られる  | `/etc/cloudflared` を root 所有・600 にする。リポジトリに置かない                                |
| 6   | 自宅回線の上り帯域・不安定さ               | Activity の応答が遅い      | 対局は小さな JSON のやり取りのみで帯域要求は低い。実測で問題が出れば M5 で検討する               |
| 7   | Cloudflare 無料枠の制約                    | 追加費用の発生             | Tunnel・DNS ともに無料枠。有料機能（Access 等）は使わない（§13 予算）                            |
| 8   | ネームサーバー移行でメール系レコードを取りこぼす | 家庭のメール受信が止まる   | **移行済みのため本 Issue では該当しない**（§4.1）。未移行と判明した場合のみ §4.1 の詳細手順に従う |

---

## 11. 完了条件

- [x] 既存構成を把握する（設定ファイル §1.2.2 / systemd §1.2.3 / ポート §1.2.4）
- [x] othello の待ち受けポートを 3100 に決定する（空きを確認済み。§1.2.4 / §5.3.1）
- [x] 既存 unit の drop-in の内容を確認し、othello の unit に取り込む（§1.2.3.1 / §5.4）
- [x] O-07 のサブドメイン名を `othello` に決定する（未使用を確認済み。§2 / §2.1）
- [ ] 要件定義 §20 の O-07 を「決定済み」に更新する
- [x] ゾーンが Cloudflare 管理下であることを確認する（§4.1。作業不要）
- [ ] named tunnel `othello` を作成し、サブドメインへ割り当てる（§4.2）
- [ ] `/etc/cloudflared/othello.yml` の ingress で `/internal/` を遮断し、`/api/` を公開する（§5.2）
- [x] `cloudflared-othello.service` と `othello.service` を `deploy/systemd/` に用意する（§5.4 / §7.1）
- [ ] ラズパイ上に `/etc/othello/othello.env` と `packages/client/.env` を用意し、ビルドする（§5.4）
- [ ] 上記 2 ファイルを実機へコピーし、systemd 常駐にする（§5.4.1）
- [ ] Developer Portal の URL Mapping を本番ホストへ変更する（§6）
- [ ] §8 の確認 1〜12 をすべて通す（**手動確認・要ユーザー実施**）

---

## 12. 後続 Issue への申し送り

- `/internal/` エンドポイントの実装時に、サーバー側でも接続元が localhost であることを
  検証する（§15 の「localhost からのみ受け付け」。ingress による遮断だけに依存しない）
- WebSocket（M3）を追加したら、Tunnel 経由で Upgrade が通ることを §8 の確認に追加する
- 本番デプロイ手順（§16.3）をまとめる Issue で、§5.4.1 のコピー手順を正式なデプロイ手順書へ
  取り込む（unit ファイル自体は本 Issue で `deploy/systemd/` に移してある）。ビルド成果物の
  配置と unit のコピーを 1 本の手順にまとめられるとよい
