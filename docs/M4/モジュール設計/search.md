# `search.ts` 詳細設計（固定深さ α-β 探索）

| 項目     | 内容                                                                          |
| -------- | ----------------------------------------------------------------------------- |
| 文書名   | `search.ts` 詳細設計                                                          |
| 版       | 0.1（初版）                                                                   |
| 最終更新 | 2026-09-12                                                                    |
| 作成者   | よこち                                                                        |
| 位置づけ | 設計書。`@othello/cpu` の `search.ts` の内部設計を定める                      |
| 関連文書 | `../モジュール定義.md`／`deepening.md`／`evaluate.md`／`../../../要件定義.md` |

---

## 1. 位置づけ

`@othello/cpu` の `search.ts` は、**固定深さ**の Minimax + α-β 枝刈りを担う。要件定義 §9.1 が「ふつう」に課す「Minimax + α-β 枝刈り、探索深さ 4〜6」と、「つよい」に課す「探索深さ 8 以上」の探索本体にあたる。

| 関係       | 相手                                                                          |
| ---------- | ----------------------------------------------------------------------------- |
| 呼び出し元 | `deepening.ts`（深さを 1 ずつ上げながら本モジュールを繰り返し呼ぶ）           |
| 依存       | `evaluate.ts`（評価値の合成と位置評価表）／`@othello/core`                    |
| 対応要件   | §9.1（アルゴリズム）／§17（テスト方針）／R-02（性能に応じて深さが決まる設計） |

**本モジュールは時刻にも乱数にも一切触れない。** 思考時間の管理は `deepening.ts`、同評価手の選択は `think.ts` の責務であり、ここは「盤面・手番・深さ・評価関数」だけから決まる決定的な関数に徹する（`../モジュール定義.md` §4 の設計判断「反復深化」を参照）。

---

## 2. 公開 API

```ts
/** 局面を player の視点で数値化する関数。重みは呼び出し側で束縛済み */
export type Evaluator = (board: Board, player: Player) => number;

/** 探索結果。同評価の最善手をすべて含む */
export type SearchResult = {
    /** 最善と判定した手。同評価の手が複数あればすべて含む。合法手が無い場合は空配列 */
    readonly moves: readonly Coord[];
    /** player 視点の評価値 */
    readonly score: number;
};

export function searchBestMoves(
    board: Board,
    player: Player,
    depth: number,
    evaluate: Evaluator,
): SearchResult;
```

| 引数       | 意味                                                             |
| ---------- | ---------------------------------------------------------------- |
| `board`    | 探索の起点となる盤面                                             |
| `player`   | 手番（この視点で評価値を返す）                                   |
| `depth`    | 読む手数。0 以下なら葉として `evaluate` の値を返す               |
| `evaluate` | 葉局面の評価関数。`evaluate.ts` の重み付き評価を部分適用して渡す |

戻り値が `Square` ではなく `Coord` なのは、`listLegalMoves` が `readonly Coord[]` を返すため。座標表記への変換は `think.ts` が `formatSquare` で行う（`../モジュール定義.md` §3.1 の `think` が `Square` を返す契約）。

### 2.1 `@othello/core` から使う API

`core/index.ts` が再エクスポートしている要素のみを使う（`core/index.ts` の規約: 「パッケージ外から参照できるのはこのファイルが再エクスポートした要素に限る」）。

| 用途         | API                                   |
| ------------ | ------------------------------------- |
| 合法手の列挙 | `listLegalMoves(board, player)`       |
| 着手の適用   | `applyMove(board, coord, player)`     |
| 終局判定     | `detectGameEnd(board)`                |
| 石数の集計   | `countCells(board)`                   |
| 相手色       | `opponent(player)`                    |
| 型           | `Board` / `Player` / `Coord` / `Cell` |

`DIRECTIONS` / `step` / `isOnBoard` / `freezeBoard` と `Direction` 型は **`core/index.ts` が再エクスポートしていない**ため使えない。本モジュールは 8 方向の走査を自前で行う必要がないため影響はない（方向走査が必要な確定石判定については `evaluate.md` §7 を参照）。

---

## 3. 探索アルゴリズム

### 3.1 negamax + α-β（fail-soft）

手番ごとに最大化／最小化を切り替えず、評価値を常に**手番側の視点**に統一する negamax 形式を採る。分岐が減り、テストで追いやすくなる。

```ts
const INFINITY = Number.POSITIVE_INFINITY;

function negamax(
    board: Board,
    player: Player,
    depth: number,
    alpha: number,
    beta: number,
    evaluate: Evaluator,
): number {
    // 終局は深さに関わらず打ち切る（§3.4）
    if (detectGameEnd(board) !== null) return terminalScore(board, player);
    if (depth <= 0) return evaluate(board, player);

    const legal = listLegalMoves(board, player);

    // 合法手が無ければパス（§3.3）
    if (legal.length === 0) {
        return -negamax(board, opponent(player), depth, -beta, -alpha, evaluate);
    }

    let best = -INFINITY;
    for (const move of orderMoves(board, legal, player)) {
        const next = applyMove(board, move, player);
        const score = -negamax(next, opponent(player), depth - 1, -beta, -alpha, evaluate);

        if (score > best) best = score;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break; // β カット
    }

    return best; // fail-soft: 窓の外なら境界値、窓の内なら厳密値
}
```

**fail-soft**（窓を外れた場合も実際に得た値を返す）を採る。§4 の根での同評価手の収集が、返り値が境界値か厳密値かの判別に依存するため。

### 3.2 終端条件

| 条件                            | 返す値                         |
| ------------------------------- | ------------------------------ |
| `detectGameEnd(board) !== null` | `terminalScore(board, player)` |
| `depth <= 0`                    | `evaluate(board, player)`      |

終局判定を深さ判定より**先**に置く。終局した局面を評価関数に渡すと、位置評価や着手可能数といった「まだ対局が続く前提の指標」が意味を持たない値を返してしまうため。

### 3.3 パスの扱い

手番側に合法手が無く、かつ終局していない場合はパスする。要件定義 §6 の「手番側に合法手が 1 つも無いとき、自動的に手番を相手へ渡す」に従う。

```ts
if (legal.length === 0) {
    return -negamax(board, opponent(player), depth, -beta, -alpha, evaluate);
}
```

**深さを減らさない。** パスは着手ではないため、パスで 1 手ぶん読む深さを失うのは不当だからである。

**無限再帰しないことの根拠**: この分岐に入った時点で `detectGameEnd(board)` は `null`、すなわち `bothPassed`（両者とも合法手が無い）ではない。したがって手番側に合法手が無いなら、相手には必ず合法手がある。つまり**パスは 2 回続かない**ため、深さを減らさなくても再帰は必ず `depth - 1` の呼び出しへ進む。

### 3.4 終局の評価

終局局面は、いかなる評価関数の値よりも優先されなければならない。石差に大きなオフセットを加えて表す。

```ts
/** 終局の評価値に与えるオフセット。評価関数が取りうる値より十分大きくする */
const WIN_SCORE = 1_000_000;

function terminalScore(board: Board, player: Player): number {
    const count = countCells(board);
    const diff = count[player] - count[opponent(player)];

    if (diff > 0) return WIN_SCORE + diff;
    if (diff < 0) return -WIN_SCORE + diff;
    return 0; // 引き分け（要件定義 §6: 同数は引き分け）
}
```

- 勝ちは常に正、負けは常に負、引き分けはちょうど 0
- 同じ勝ちでも石差が大きいほど高い値になる。要件定義 §6 の「石数が多い方の勝ち」と整合し、完全読み（`endgame.md`）でそのまま石差最大化として働く
- `WIN_SCORE` は `evaluate.ts` が返しうる値の上限より十分大きく取る（`evaluate.md` §3 に上限の見積りを置く）

---

## 4. 根での最善手の集約

### 4.1 課題

`think.ts` は「最善手が複数あるときだけ乱択する」（`../モジュール定義.md` §4）。そのためには**同評価の最善手を漏れなく、かつ誤りなく**集める必要がある。ところが α-β 枝刈りを素朴に使うと、これができない。

α カットで打ち切られた手の返り値は**上界**でしかなく、「best より悪い」ことは分かっても「best と等しいのか、もっと悪いのか」が判別できないためである。窓を狭めたまま同値を拾おうとすると、本来同評価の手を取りこぼす。

### 4.2 採用する方法：窓を 1 だけ広げる

根では β を常に `+∞` に固定し、α を `best - 1` とする。

```ts
export function searchBestMoves(
    board: Board,
    player: Player,
    depth: number,
    evaluate: Evaluator,
): SearchResult {
    if (detectGameEnd(board) !== null) {
        return { moves: [], score: terminalScore(board, player) };
    }

    const legal = listLegalMoves(board, player);
    if (legal.length === 0) {
        // 根でのパス。手を返さず、手番を渡した先の評価だけを返す
        const score = -negamax(board, opponent(player), depth, -INFINITY, INFINITY, evaluate);
        return { moves: [], score };
    }

    let best = -INFINITY;
    let bestMoves: Coord[] = [];

    for (const move of orderMoves(board, legal, player)) {
        const next = applyMove(board, move, player);

        // 1 手目は全窓。2 手目以降は (best - 1, +∞)
        const alpha = bestMoves.length === 0 ? -INFINITY : best - 1;
        const score = -negamax(next, opponent(player), depth - 1, -INFINITY, -alpha, evaluate);

        if (score > best) {
            best = score;
            bestMoves = [move];
        } else if (score === best) {
            bestMoves.push(move);
        }
        // score < best（＝ score <= best - 1）は上界にすぎないが、
        // 上界が best 未満である以上その手は厳密に劣るため捨ててよい
    }

    return { moves: bestMoves, score: best };
}
```

**この窓が正しい理由**

根の β は `+∞` なので、子の呼び出しは β 側で打ち切られない。よって返り値 `score` は次のいずれかになる。

| 返り値の位置        | 意味                       | 扱い                                        |
| ------------------- | -------------------------- | ------------------------------------------- |
| `score <= best - 1` | 上界。真の値は `best` 未満 | 厳密に劣る手として捨てる                    |
| `score >= best`     | 窓の内側であり**厳密値**   | `best` と比較して更新、または同値として追加 |

評価値が整数であれば `score <= best - 1` と `score < best` は同値になるため、**同評価の手を取りこぼさない**。同時に、窓は標準の α-β より 1 だけ広いにすぎず、枝刈りの効果はほぼ失われない。

### 4.3 評価値が整数であることの要請

§4.2 は `best - 1` が「`best` の次に小さい値」であることに依存する。したがって **`evaluate.ts` が返す値と `terminalScore` の値は必ず整数でなければならない**。

この制約は `evaluate.md` §3 に評価値の規約として明記し、重み・成分ともに整数で設計する。重み付き合成で小数が生じる設計（比率での重み付けなど）は採らない。

---

## 5. 着手順序（move ordering）

α-β の枝刈り効率は着手順序に強く依存する。良い手を先に調べるほど早く β カットが起き、同じ深さを読む時間が短くなる。R-02（ラズパイの性能で「つよい」が名前倒れになる）への対策として、実装コストの低い静的順序付けを入れる。

```ts
function orderMoves(board: Board, moves: readonly Coord[], player: Player): readonly Coord[] {
    // 位置評価表の重みが高いマスを先に調べる。
    // 表は evaluate.ts が持つものを共有する（重複定義を避ける）
    return [...moves].sort((a, b) => positionWeightOf(b) - positionWeightOf(a));
}
```

| 方針                                                     | 理由                                                                                                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `evaluate.ts` の位置評価表を流用し、重みの高い順に調べる | 角を最優先し、X 打ち・C 打ちを後回しにできる。追加のコストが無い                                                                              |
| 動的な順序付け（前反復の最善手を先頭に置く等）は入れない | `searchBestMoves` の 4 引数の契約に前反復の結果を渡す口がない。導入には API を広げる必要があり、実装量（要件定義 R-08）に対して M4 では見送る |

**安定ソートであること**が決定性の前提になる（§7）。`Array.prototype.sort` は ES2019 以降で安定と規定されているため、重みが同じマスは `listLegalMoves` の走査順（a1 → h8、row 昇順・その中で col 昇順）を保つ。

---

## 6. 置換表を持たない判断

**M4 では置換表（transposition table）を実装しない。**

| 観点                             | 判断の根拠                                                                                                                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 決定性                           | 置換表は探索順序によって返す値・返す手が変わりうるため、§7 の決定性が崩れる。既知局面のテスト（要件定義 §17）が不安定になる。反復深化を `deepening.ts` へ分離したのと同じ理由で、ここは崩したくない                |
| メモリ制約                       | worker は**対局中ずっと常駐**する（`../モジュール定義.md` §4）。置換表を持たせるとそのメモリを対局中ずっと占有し、同時 3 対局では最大 3 worker 分になる。要件定義 R-06「Sebastian と同居することによるメモリ不足」 |
| 実装量                           | Zobrist ハッシュ、エントリの置換戦略、世代管理が必要になる。要件定義 R-08（実装量が個人開発の許容量を超える）に対して M4 では割に合わない                                                                          |
| 手をまたいだ再利用は可能になった | worker の常駐化により、前の手の探索で得た表を次の手へ引き継ぐ**技術的な障害はなくなった**。それでも見送るのは上の 3 点による判断である                                                                             |

**再検討の条件**: O-06 の実測（`bench.ts`）で「つよい」が要件定義 §9.1 の「探索深さ 8 以上」に届かない場合、**置換表の導入を最優先の改善候補**とする。worker が常駐する以上、手をまたいで表を温める効果は大きい。その際は決定性をテストでどう担保するかを併せて設計する（探索のテストは置換表を無効化して実行する、置換表を有効にしても同じ手を返すことを別途検証する、など）。

---

## 7. 決定性の保証

本モジュールは、同じ `(board, player, depth, evaluate)` に対して**常に同じ `SearchResult` を返す**。

| 保証の内訳           | 根拠                                                                         |
| -------------------- | ---------------------------------------------------------------------------- |
| 時刻に依存しない     | `Date.now()` / `performance.now()` を一切呼ばない。時間管理は `deepening.ts` |
| 乱数に依存しない     | `Math.random()` を呼ばない。乱択は `think.ts` が注入された乱数で行う         |
| 合法手の走査順が固定 | `listLegalMoves` が a1 → h8 の固定順を保証している                           |
| 着手順序が安定       | §5 のとおり安定ソートを用いる                                                |
| 同評価手の並びが固定 | `bestMoves` への追加順が走査順に従う                                         |

これは要件定義 §17 の「既知の局面で妥当な手を選ぶこと」を、開発機とラズパイで同じ結果として検証できるようにするための性質である。反復深化（時間で到達深さが変わる）を `deepening.ts` へ分離したのは、まさにこの性質を守るためである。

---

## 8. 評価関数を引数で受け取る理由

`searchBestMoves` は `EvalWeights` ではなく `Evaluator` 関数を受け取る。

1. **テストで固定値評価を注入できる**。「すべての局面を 0 と評価する」評価関数を渡せば、α-β の枝刈りが探索結果を変えないこと（§9 のテスト観点）を評価関数の実装と無関係に検証できる
2. **終盤完全読みで評価を差し替えられる**。`endgame.ts` は石差のみの評価を渡す（`endgame.md` を参照）。探索側に分岐を持たせずに済む
3. **`search.ts` が `EvalWeights` の形に依存しない**。評価成分を追加・変更しても `search.ts` は無改修で済む

重みの束縛は `think.ts` が行う。

```ts
const evaluator: Evaluator = (b, p) => evaluate(b, p, config.weights);
const result = searchBestMoves(board, player, depth, evaluator);
```

---

## 9. テスト観点

要件定義 §17 の「CPU 思考: 既知の局面で妥当な手を選ぶこと」に対応する。本モジュールは決定的なので、時間に依存するテストは書かない（それは `deepening.md` の範囲）。

| #   | 観点                   | 内容                                                                                                                                                                                |
| --- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | α-β の正しさ           | 固定値でない評価関数を用い、**α-β 無しの全探索**（窓を使わない素朴な negamax）と `searchBestMoves` が**同じ評価値と同じ最善手集合**を返すこと。複数の深さ・複数の既知局面で検証する |
| 2   | 同評価手の収集         | 対称な局面（初期盤面など、複数の合法手が同値になる局面）で、同評価の手が**すべて**返ること                                                                                          |
| 3   | 決定性                 | 同じ入力を複数回呼んで、返る `moves` の並びまで一致すること                                                                                                                         |
| 4   | 終局の優先             | 深さが残っていても終局局面では `terminalScore` が返ること。勝ちが常に正、負けが常に負、引き分けがちょうど 0 であること                                                              |
| 5   | パス                   | 手番側に合法手が無い局面で、深さを消費せずに相手へ手番が渡ること。パスが 2 回続く局面が終局として扱われること                                                                       |
| 6   | 深さ 0                 | `depth = 0` で `evaluate` の値がそのまま返ること                                                                                                                                    |
| 7   | 合法手が無い根         | 根でパスになる場合に `moves` が空配列で返り、呼び出し側が誤って着手しないこと                                                                                                       |
| 8   | 評価関数の呼び出し回数 | 固定値評価を注入し、着手順序を変えたときに葉の評価回数が減ること（枝刈りが効いていることの確認）                                                                                    |

初期盤面は 4 つの合法手（d3・c4・f5・e6）が対称で同値になるため、観点 2 の素材として使える。

---

## 10. O-06 との関係

本モジュール自体は探索深さを決めない。深さは `deepening.ts` が時間上限の範囲で反復深化により決め、その上限値は `level.ts` が持つ（O-06 の未決事項）。

`bench.ts` は本モジュールを固定深さで直接呼び、**深さごとの所要時間**を測る。その結果が O-06 の「各強度の探索深さと思考時間上限」の決定根拠になる（要件定義 §17 実機・§20 O-06）。
