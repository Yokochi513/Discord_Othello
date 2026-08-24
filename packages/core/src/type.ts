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
