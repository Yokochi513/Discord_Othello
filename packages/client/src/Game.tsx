/**
 * 対局画面（要件定義 §7.3 / F-06〜F-09・F-11〜F-13）。
 *
 * 何を出すか・どのマスが押せるかの判断は gameView.ts が組み立てた結果に従い、
 * ここは描画と操作の呼び出しだけを行う。表記は全文日本語・簡潔にする（要件定義 §7.5）。
 * 手番の残り時間は表示しない（要件定義 §7.6 のとおり時間制限を設けない）。
 */

import { useState } from "react";

import { buildGameView, type CellView, type PlayerView } from "./gameView.ts";
import type { ClientState } from "./roomState.ts";
import type { GameActions } from "./useGameSession.ts";

/** 対局画面に渡す値。 */
export type GameProps = {
    /** サーバー通知から組み立てた現在の状態 */
    readonly state: ClientState;
    /** 着手・投了・中断の操作 */
    readonly actions: GameActions;
};

// 取り消しの効かない操作は、確認を挟んでから送る（要件定義 §7.3 の操作ボタン）
type ControlKind = "resign" | "abort";

const CONTROL_LABELS: Readonly<Record<ControlKind, string>> = { resign: "投了", abort: "中断" };

const CONFIRM_MESSAGES: Readonly<Record<ControlKind, string>> = {
    resign: "投了すると負けになります。よろしいですか？",
    abort: "中断すると無効試合になります。よろしいですか？",
};

/**
 * 対局画面を描く。
 * @param props 対局画面に渡す値
 * @returns 画面の要素
 */
export function Game(props: GameProps): React.JSX.Element {
    const { state, actions } = props;
    // 確認中の操作。null なら確認を求めていない
    const [confirming, setConfirming] = useState<ControlKind | null>(null);
    const view = buildGameView(state);

    if (view === null) return <p className="app__status">対局を読み込んでいます…</p>;

    return (
        <section className="app__screen">
            <h2 className="app__heading">対局中</h2>

            <ul className="game__players">
                {view.players.map((player) => (
                    <li key={player.seat} className="game__player">
                        <Player player={player} />
                    </li>
                ))}
            </ul>

            <p className="game__turn">
                {view.turnNotice}
                <span className="game__moveCount">手数 {view.moveCount}</span>
            </p>

            <div className="game__board">
                {view.cells.map((cell) => (
                    <Cell key={cell.square} cell={cell} onPlay={actions.play} />
                ))}
            </div>

            {view.passNotice !== null && <p className="app__notice">{view.passNotice}</p>}

            {view.isPlayer &&
                (confirming === null ? (
                    <div className="app__actions">
                        {(["resign", "abort"] as const).map((kind) => (
                            <button
                                key={kind}
                                type="button"
                                disabled={!view.canControl}
                                onClick={() => setConfirming(kind)}
                            >
                                {CONTROL_LABELS[kind]}
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="game__confirm">
                        <p className="game__confirmText">{CONFIRM_MESSAGES[confirming]}</p>
                        <div className="app__actions">
                            <button
                                type="button"
                                disabled={!view.canControl}
                                onClick={() => {
                                    setConfirming(null);
                                    if (confirming === "resign") actions.resign();
                                    else actions.abort();
                                }}
                            >
                                はい
                            </button>
                            <button type="button" onClick={() => setConfirming(null)}>
                                いいえ
                            </button>
                        </div>
                    </div>
                ))}
        </section>
    );
}

// 対局者 1 人分。表示名・石数・接続状態を常に出し、手番側を目立たせる（要件定義 §7.3）
function Player({ player }: { readonly player: PlayerView }): React.JSX.Element {
    return (
        <>
            <span className="game__mark" aria-hidden="true">
                {player.mark}
            </span>
            <span className="game__label">{player.label}</span>
            <span className="game__name">
                {player.displayName}
                {player.mine && <span className="game__you">（あなた）</span>}
            </span>
            <span
                className={
                    player.connected
                        ? "game__connection"
                        : "game__connection game__connection--offline"
                }
            >
                {player.connectionLabel}
            </span>
            <span className="game__score">{player.score}</span>
            {player.inTurn && <span className="game__inTurn">手番</span>}
        </>
    );
}

// 盤上のマス 1 つ。着手できないマスは無効化するので、観戦者の操作は届かない（F-13）
function Cell({
    cell,
    onPlay,
}: {
    readonly cell: CellView;
    readonly onPlay: GameActions["play"];
}): React.JSX.Element {
    const classNames = ["game__cell"];
    if (cell.legal) classNames.push("game__cell--legal");
    if (cell.last) classNames.push("game__cell--last");

    return (
        <button
            type="button"
            className={classNames.join(" ")}
            disabled={!cell.playable}
            aria-label={cell.square}
            onClick={() => onPlay(cell.square)}
        >
            {cell.stone !== "empty" && <Disc stone={cell.stone} />}
            {cell.legal && <span className="game__hint" aria-hidden="true" />}
        </button>
    );
}

// 石。表裏を重ねた 1 枚を回転させ、色が変わると反転して見えるようにする（要件定義 §7.3）
function Disc({ stone }: { readonly stone: "black" | "white" }): React.JSX.Element {
    return (
        <span className="game__disc">
            <span className={`game__discInner game__discInner--${stone}`}>
                <span className="game__face game__face--black" />
                <span className="game__face game__face--white" />
            </span>
        </span>
    );
}
