/**
 * Activity のルートコンポーネント。
 *
 * Discord SDK の初期化後にサーバーへ WebSocket 接続し、サーバーから届く状態通知だけで
 * ロビー・対局・終局を切り替える（要件定義 §5.4 / §7.1）。
 * 各画面の中身は Lobby.tsx・Game.tsx・Finished.tsx が受け持ち、ここは
 * 初期化・接続・画面の振り分けと、全画面に共通する通知の表示だけを行う。
 */

import type { IDiscordSDK } from "@discord/embedded-app-sdk";
import { useEffect, useState } from "react";

import { initDiscordSession, type DiscordSession } from "./discordSdk.ts";
import { loadClientConfig, type ClientConfig } from "./env.ts";
import { toErrorMessage } from "./errorMessage.ts";
import { Finished } from "./Finished.tsx";
import { Game } from "./Game.tsx";
import { Lobby } from "./Lobby.tsx";
import type { AvatarMap } from "./participants.ts";
import { selectPhase, type ClientState } from "./roomState.ts";
import { useGameSession, type GameActions } from "./useGameSession.ts";
import { useParticipantAvatars } from "./useParticipants.ts";

// 初期化の進行状態
type InitState =
    | { readonly status: "loading" }
    | { readonly status: "ready"; readonly session: DiscordSession; readonly config: ClientConfig }
    | { readonly status: "error"; readonly message: string };

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
            {/* 通知は画面に重ねる。出入りしても盤面の大きさが変わらない（要件定義 §7.3） */}
            <div className="app__notices">
                <ConnectionNotice state={state} />
                <ErrorNotice state={state} actions={actions} />
            </div>
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
