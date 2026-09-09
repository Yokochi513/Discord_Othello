/**
 * 終局画面（要件定義 §7.4 / F-10・F-19）。
 *
 * 何を出すか・何が押せるかの判断は finishedView.ts が組み立てた結果に従い、
 * ここは描画と操作の呼び出しだけを行う。最終盤面の描画は Board.tsx が受け持つ。
 * 表記は全文日本語・簡潔にする（要件定義 §7.5）。
 */

import { Board } from "./Board.tsx";
import { buildFinishedView, type FinishedPlayerView } from "./finishedView.ts";
import type { ClientState } from "./roomState.ts";
import type { GameActions } from "./useGameSession.ts";

/** 終局画面に渡す値。 */
export type FinishedProps = {
    /** サーバー通知から組み立てた現在の状態 */
    readonly state: ClientState;
    /** 再戦・ロビーへ戻るの操作 */
    readonly actions: GameActions;
};

/**
 * 終局画面を描く。
 * @param props 終局画面に渡す値
 * @returns 画面の要素
 */
export function Finished(props: FinishedProps): React.JSX.Element {
    const { state, actions } = props;
    const view = buildFinishedView(state);
    if (view === null) return <p className="app__status">結果を読み込んでいます…</p>;

    return (
        <section className="app__screen">
            {/* 終局であることは勝敗の行から読み取れるため、見出しは読み上げ用に留める */}
            <h2 className="app__heading app__heading--offscreen">終局</h2>

            <div className="finished__result">
                <p
                    className={
                        view.invalid
                            ? "finished__outcome finished__outcome--invalid"
                            : "finished__outcome"
                    }
                >
                    {view.outcomeLabel}
                </p>
                <p className="finished__reason">{view.reasonLabel}</p>
                <p className="finished__moveCount">手数 {view.moveCount}</p>
            </div>

            <ul className="finished__players">
                {view.players.map((player) => (
                    <li
                        key={player.seat}
                        className={
                            player.winner
                                ? "finished__player finished__player--winner"
                                : "finished__player"
                        }
                    >
                        <Player player={player} />
                    </li>
                ))}
            </ul>

            {/* 最終盤面。印も操作も出さず、決着した局面をそのまま見せる（要件定義 §7.4） */}
            <Board cells={view.cells} />

            <div className="app__actions">
                {/* 再戦を始められるのは座席に着いている側だけ。観戦者には出さない */}
                {view.showRematch && (
                    <button type="button" disabled={!view.canRematch} onClick={actions.rematch}>
                        もう一局
                    </button>
                )}
                <button type="button" onClick={actions.returnToLobby}>
                    ロビーへ戻る
                </button>
            </div>

            {view.showRematch ? (
                <p className="finished__hint">{view.rematchHint}</p>
            ) : (
                <p className="finished__hint">
                    次の対局は座席に着いている 2 人が始めます。始まると自動で盤面に切り替わります
                </p>
            )}
        </section>
    );
}

// 対局者 1 人分。最終石数を出し、勝者を目立たせる（要件定義 §7.4）
function Player({ player }: { readonly player: FinishedPlayerView }): React.JSX.Element {
    return (
        <>
            <span className="finished__mark" aria-hidden="true">
                {player.mark}
            </span>
            <span className="finished__label">{player.label}</span>
            <span className="finished__name">
                {player.displayName}
                {player.mine && <span className="finished__you">（あなた）</span>}
            </span>
            {player.winner && <span className="finished__winner">勝ち</span>}
            <span className="finished__score">{player.score}</span>
        </>
    );
}
