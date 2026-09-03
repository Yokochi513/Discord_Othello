/**
 * Activity のルートコンポーネント。
 *
 * 本 Issue（M2-2）では SDK の初期化結果を表示するだけに留める。
 * ロビー・対局・終局・戦績の各画面（要件定義 §7.1）は後続のマイルストーンで実装する。
 */

import { useEffect, useState } from "react";

import { initDiscordSession, type DiscordSession } from "./discordSdk.ts";
import { loadClientConfig } from "./env.ts";
import { toErrorMessage } from "./errorMessage.ts";

// 初期化の進行状態
type InitState =
    | { readonly status: "loading" }
    | { readonly status: "ready"; readonly session: DiscordSession }
    | { readonly status: "error"; readonly message: string };

/**
 * Activity のルートコンポーネント。
 * 起動時に Discord SDK を初期化し、その結果を表示する。
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
                if (!cancelled) setState({ status: "ready", session });
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
            {renderStatus(state)}
        </main>
    );
}

// 進行状態に応じた表示を組み立てる（表示は全文日本語：要件定義 §7.5）
function renderStatus(state: InitState): React.JSX.Element {
    switch (state.status) {
        case "loading":
            return <p className="app__status">Discord に接続しています…</p>;
        case "ready":
            return (
                <div className="app__status">
                    <p>準備完了</p>
                    <dl className="app__detail">
                        <dt>実行環境</dt>
                        <dd>
                            {state.session.embedded ? "Discord Activity" : "ブラウザ（モック）"}
                        </dd>
                        <dt>インスタンス ID</dt>
                        <dd>{state.session.instanceId}</dd>
                    </dl>
                </div>
            );
        case "error":
            return (
                <p className="app__status app__status--error">
                    初期化に失敗しました: {state.message}
                </p>
            );
    }
}
