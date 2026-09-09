/**
 * 対局画面（要件定義 §7.3 / F-06〜F-09・F-11〜F-13）。
 *
 * 何を出すか・どのマスが押せるかの判断は gameView.ts が組み立てた結果に従い、
 * ここは描画と操作の呼び出しだけを行う。盤面そのものの描画は Board.tsx が受け持つ。
 * 表記は全文日本語・簡潔にする（要件定義 §7.5）。
 * 手番の残り時間は表示しない（要件定義 §7.6 のとおり時間制限を設けない）。
 */

import { useState } from "react";

import { Board } from "./Board.tsx";
import { buildGameView, type PlayerView } from "./gameView.ts";
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
            {/* 対局中であることは手番の行から読み取れるため、見出しは読み上げ用に留める */}
            <h2 className="app__heading app__heading--offscreen">対局中</h2>

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

            {/* パス通知と確認は盤に重ね、出入りで盤の大きさを変えない（要件定義 F-09） */}
            <div className="game__boardWrap">
                <Board cells={view.cells} onPlay={actions.play} />

                {view.passNotice !== null && (
                    <p className="app__notice game__pass">{view.passNotice}</p>
                )}

                {confirming !== null && (
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
                )}
            </div>

            {view.isPlayer && (
                <div className="app__actions">
                    {(["resign", "abort"] as const).map((kind) => (
                        <button
                            key={kind}
                            type="button"
                            disabled={!view.canControl || confirming !== null}
                            onClick={() => setConfirming(kind)}
                        >
                            {CONTROL_LABELS[kind]}
                        </button>
                    ))}
                </div>
            )}
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
