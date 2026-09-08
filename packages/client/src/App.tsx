/**
 * Activity のルートコンポーネント。
 *
 * Discord SDK の初期化後にサーバーへ WebSocket 接続し、サーバーから届く状態通知だけで
 * ロビー・対局・終局を切り替える（要件定義 §5.4 / §7.1）。
 * ロビー画面は Lobby.tsx が受け持つ。対局・終局の作り込みは M3-7〜M3-8 で行うため、
 * ここでは状態が正しく遷移していることを確かめられる最小限の表示に留める。
 */

import type { IDiscordSDK } from "@discord/embedded-app-sdk";
import type { GameEndReason, GameState, Outcome } from "@othello/protocol";
import { useEffect, useState } from "react";

import { initDiscordSession, type DiscordSession } from "./discordSdk.ts";
import { loadClientConfig, type ClientConfig } from "./env.ts";
import { toErrorMessage } from "./errorMessage.ts";
import { Lobby } from "./Lobby.tsx";
import type { AvatarMap } from "./participants.ts";
import {
    selectGame,
    selectIsPlayer,
    selectPhase,
    type ClientState,
    type SeatId,
} from "./roomState.ts";
import { useGameSession, type GameActions } from "./useGameSession.ts";
import { useParticipantAvatars } from "./useParticipants.ts";

// 初期化の進行状態
type InitState =
    | { readonly status: "loading" }
    | { readonly status: "ready"; readonly session: DiscordSession; readonly config: ClientConfig }
    | { readonly status: "error"; readonly message: string };

// 座席の色の表示名
const SEAT_LABELS: Readonly<Record<SeatId, string>> = { black: "黒", white: "白" };

// 終局理由の表示名（要件定義 §6 / §7.4）
const REASON_LABELS: Readonly<Record<GameEndReason, string>> = {
    both_passed: "両者が続けてパスしました",
    board_full: "盤面が埋まりました",
    shutout: "一方の石が無くなりました",
    resign: "投了で決着しました",
    abort: "中断されました（無効試合）",
    disconnect: "対局者が離脱しました（無効試合）",
};

// 勝敗の表示名
const OUTCOME_LABELS: Readonly<Record<Outcome, string>> = {
    black_win: "黒の勝ち",
    white_win: "白の勝ち",
    draw: "引き分け",
};

/**
 * Activity のルートコンポーネント。
 * 起動時に Discord SDK を初期化し、完了後は対局セッションの画面へ引き渡す。
 * @returns 画面の要素
 */
export function App(): React.JSX.Element {
    const [state, setState] = useState<InitState>({ status: "loading" });

    useEffect(() => {
        // StrictMode では effect が 2 回走るため、後片付け後の setState を抑止する
        let cancelled = false;

        void (async () => {
            try {
                const config = loadClientConfig(import.meta.env, window.location.search);
                const session = await initDiscordSession(config);
                if (!cancelled) setState({ status: "ready", session, config });
            } catch (error) {
                if (!cancelled) setState({ status: "error", message: toErrorMessage(error) });
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <main className="app">
            <h1 className="app__title">オセロ</h1>
            <Content state={state} />
        </main>
    );
}

// 初期化の進行状態に応じて、待機・エラー・対局セッションを出し分ける
function Content({ state }: { readonly state: InitState }): React.JSX.Element {
    if (state.status === "loading") {
        return <p className="app__status">Discord に接続しています…</p>;
    }
    if (state.status === "error") {
        return (
            <p className="app__status app__status--error">初期化に失敗しました: {state.message}</p>
        );
    }
    // iframe 外ではモック SDK を使い認証しないため、サーバーへ接続する資格情報が無い
    if (state.session.accessToken === null) {
        return (
            <p className="app__status">
                ブラウザで直接開いています。対局するには Discord から Activity を起動してください。
            </p>
        );
    }

    return (
        <Room
            config={state.config}
            sdk={state.session.sdk}
            accessToken={state.session.accessToken}
            instanceId={state.session.instanceId}
        />
    );
}

// サーバーへ接続し、届いた状態に従って画面を切り替える
function Room({
    config,
    sdk,
    accessToken,
    instanceId,
}: {
    readonly config: ClientConfig;
    readonly sdk: IDiscordSDK;
    readonly accessToken: string;
    readonly instanceId: string;
}): React.JSX.Element {
    const { state, actions } = useGameSession(config, { accessToken, instanceId });
    // 表示名はサーバーから届くが、アバターは Discord SDK から解決する（要件定義 §11.5）
    const avatars = useParticipantAvatars(sdk);

    return (
        <>
            <ConnectionNotice state={state} />
            <ErrorNotice state={state} actions={actions} />
            <Screen state={state} actions={actions} avatars={avatars} />
        </>
    );
}

// 表示は全文日本語とする（要件定義 §7.5）
function Screen({
    state,
    actions,
    avatars,
}: {
    readonly state: ClientState;
    readonly actions: GameActions;
    readonly avatars: AvatarMap;
}): React.JSX.Element {
    switch (selectPhase(state)) {
        case "connecting":
            return <p className="app__status">サーバーに接続しています…</p>;
        case "lobby":
            return <Lobby state={state} actions={actions} avatars={avatars} />;
        case "playing":
            return <Game state={state} actions={actions} />;
        case "finished":
            return <Finished state={state} actions={actions} />;
    }
}

// 接続が切れている間だけ、その旨を知らせる（要件定義 §14 E-15）
function ConnectionNotice({ state }: { readonly state: ClientState }): React.JSX.Element | null {
    switch (state.connection) {
        case "open":
        case "connecting":
            return null;
        case "reconnecting":
            return <p className="app__notice">接続が切れました。再接続しています…</p>;
        case "closed":
            return <p className="app__notice app__notice--error">サーバーとの接続が切れました。</p>;
    }
}

// サーバーから届いたエラーと、送信できなかった操作のエラーを表示する
function ErrorNotice({
    state,
    actions,
}: {
    readonly state: ClientState;
    readonly actions: GameActions;
}): React.JSX.Element | null {
    if (state.errorMessage === null) return null;

    return (
        <p className="app__notice app__notice--error">
            {state.errorMessage}
            <button type="button" className="app__dismiss" onClick={actions.dismissError}>
                閉じる
            </button>
        </p>
    );
}

// 対局画面。盤面の描画と着手は M3-7 で行うため、ここでは進行状況だけを示す
function Game({
    state,
    actions,
}: {
    readonly state: ClientState;
    readonly actions: GameActions;
}): React.JSX.Element {
    const game = selectGame(state);
    if (game === null) return <p className="app__status">対局を読み込んでいます…</p>;

    return (
        <section className="app__screen">
            <h2 className="app__heading">対局中</h2>
            <GameDetail game={game} />
            {state.passedBy.length > 0 && (
                <p className="app__notice">
                    {state.passedBy.map((seat) => SEAT_LABELS[seat]).join("・")}
                    は打てるマスが無いためパスしました
                </p>
            )}
            {selectIsPlayer(state) && (
                <div className="app__actions">
                    <button type="button" onClick={actions.resign}>
                        投了
                    </button>
                    <button type="button" onClick={actions.abort}>
                        中断
                    </button>
                </div>
            )}
        </section>
    );
}

// 終局画面。再戦は M3-8 で扱う
function Finished({
    state,
    actions,
}: {
    readonly state: ClientState;
    readonly actions: GameActions;
}): React.JSX.Element | null {
    if (state.finished === null) return null;
    const { game, result } = state.finished;

    return (
        <section className="app__screen">
            <h2 className="app__heading">終局</h2>
            <p className="app__status">
                {result.outcome === null ? "無効試合" : OUTCOME_LABELS[result.outcome]}
            </p>
            <p className="app__status">{REASON_LABELS[result.reason]}</p>
            <GameDetail game={game} />
            <div className="app__actions">
                <button type="button" onClick={actions.returnToLobby}>
                    ロビーへ戻る
                </button>
            </div>
        </section>
    );
}

// 対局・終局で共通の内訳表示
function GameDetail({ game }: { readonly game: GameState }): React.JSX.Element {
    return (
        <dl className="app__detail">
            <dt>黒</dt>
            <dd>
                {game.players.black.displayName}（{game.scores.black} 石）
            </dd>
            <dt>白</dt>
            <dd>
                {game.players.white.displayName}（{game.scores.white} 石）
            </dd>
            <dt>手番</dt>
            <dd>{game.turn === null ? "なし" : SEAT_LABELS[game.turn]}</dd>
            <dt>手数</dt>
            <dd>{game.moveCount}</dd>
            <dt>直前の手</dt>
            <dd>{game.lastMove ?? "なし"}</dd>
        </dl>
    );
}
