/** 石の色は。先手は黒 */
export type Player = "black" | "white";

/** マスの状態。空 / 黒 / 白 の 3値 */
export type Cell = Player | "empty";

/** 列。左から a〜h */
export type File = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h";

/** 行。上から 1〜8 */
export type Rank = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8";

/** 座標表記。左上が a1、右下が h8 の 64 マス */
export type Square = `${File}${Rank}`;

/** 盤面配列の内部インデックス。board[row][col] に対応し、row / col とも 0〜7 */
export type Coord = {
    readonly row: number;
    readonly col: number;
};

/** 8方向の走査に用いる方向ベクトル。盤上の位置ではなく、1ステップぶんの移動量を表す */
export type Direction = {
    readonly rowDelta: number;
    readonly colDelta: number;
};

/** 手番遷移の結果。パスが起きたかどうかを呼び出し側へ伝えるための判別可能なユニオン */
export type TurnResult =
    /** 通常遷移。相手に合法手があり、そのまま手番が移る */
    | { readonly kind: "next"; readonly player: Player }
    /** 自動パス。相手に合法手が無く、手番がplayer側へ戻る。passedByがパスした側 */
    | { readonly kind: "pass"; readonly player: Player; readonly passedBy: Player }
    /** 連続パス。両者とも合法手が無い。終局判定はここでは行わない */
    | { readonly kind: "bothPassed"; readonly passedBy: [Player, Player] };
