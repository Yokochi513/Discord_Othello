/**
 * 盤面の描画（要件定義 §7.3 / §7.4）。
 *
 * 対局画面と終局画面で同じ 8×8 の盤を描くため、マスと石の描画をここにまとめる。
 * 何を出すか・どのマスが押せるかの判断は boardView.ts が組み立てた結果に従い、
 * ここは描画と操作の呼び出しだけを行う。
 */

import type { Square } from "@othello/protocol";

import type { CellView } from "./boardView.ts";

/** 盤面に渡す値。 */
export type BoardProps = {
    /** a1 から h8 まで、行昇順・列昇順に並べた 64 マス */
    readonly cells: readonly CellView[];
    /** マスを押したときの着手。最終盤面のように操作しない盤では省略する */
    readonly onPlay?: ((square: Square) => void) | undefined;
};

/**
 * CSS Grid の 8×8 で盤面を描く。
 * @param props 盤面に渡す値
 * @returns 盤面の要素
 */
export function Board(props: BoardProps): React.JSX.Element {
    const { cells, onPlay } = props;

    return (
        <div className="board">
            {cells.map((cell) => (
                <Cell key={cell.square} cell={cell} onPlay={onPlay} />
            ))}
        </div>
    );
}

// 盤上のマス 1 つ。着手できないマスは無効化するので、観戦者の操作は届かない（F-13）
function Cell({
    cell,
    onPlay,
}: {
    readonly cell: CellView;
    readonly onPlay?: ((square: Square) => void) | undefined;
}): React.JSX.Element {
    const classNames = ["board__cell"];
    if (cell.legal) classNames.push("board__cell--legal");
    if (cell.last) classNames.push("board__cell--last");

    return (
        <button
            type="button"
            className={classNames.join(" ")}
            disabled={!cell.playable}
            aria-label={cell.square}
            onClick={() => onPlay?.(cell.square)}
        >
            {cell.stone !== "empty" && <Disc stone={cell.stone} />}
            {cell.legal && <span className="board__hint" aria-hidden="true" />}
        </button>
    );
}

// 石。表裏を重ねた 1 枚を回転させ、色が変わると反転して見えるようにする（要件定義 §7.3）
function Disc({ stone }: { readonly stone: "black" | "white" }): React.JSX.Element {
    return (
        <span className="board__disc">
            <span className={`board__discInner board__discInner--${stone}`}>
                <span className="board__face board__face--black" />
                <span className="board__face board__face--white" />
            </span>
        </span>
    );
}
