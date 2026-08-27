/**
 * Discord Embedded App SDK の初期化。
 *
 * 本 Issue（M2-2）では ready() までの疎通に限定する。OAuth2 の認可（authorize /
 * トークン交換）は client secret をサーバー側に置く必要があるため、後続 Issue で
 * サーバーと合わせて実装する（要件定義 §13 / §15）。
 */

import { DiscordSDK, DiscordSDKMock, type IDiscordSDK } from "@discord/embedded-app-sdk";

import type { ClientConfig } from "./env.ts";

/** SDK の初期化結果 */
export type DiscordSession = {
    /** 初期化済みの SDK。iframe 外ではモック実装 */
    readonly sdk: IDiscordSDK;
    /** Activity のインスタンス ID。対局への参加可否の判定に使う（要件定義 §15） */
    readonly instanceId: string;
    /** Discord Activity の iframe 内で動作しているか */
    readonly embedded: boolean;
};

/**
 * ready() の応答を待つ上限時間。
 * 超過を例外にしないと、画面が理由のわからないまま止まる（要件定義 §14 E-15）。
 */
const READY_TIMEOUT_MS = 10_000;

/**
 * Embedded App SDK を初期化し、ready() の完了まで待つ。
 * iframe 外（ブラウザで直接開いた場合）はモックを使い、開発を継続できるようにする。
 * @param config クライアントの実行時設定
 * @returns 初期化済みのセッション
 */
export async function initDiscordSession(config: ClientConfig): Promise<DiscordSession> {
    const sdk = createSdk(config);
    await withTimeout(sdk.ready(), READY_TIMEOUT_MS);

    return {
        sdk,
        instanceId: sdk.instanceId,
        embedded: config.embedded,
    };
}

// 実行環境に応じて実物とモックを選ぶ。
// DiscordSDK は起動クエリ（frame_id 等）を前提とするため、iframe 外では構築できない
function createSdk(config: ClientConfig): IDiscordSDK {
    if (config.embedded) return new DiscordSDK(config.discordClientId);
    return new DiscordSDKMock(config.discordClientId, null, null, null);
}

// 応答が返らないまま待ち続けないよう、上限時間を被せる
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(
                new Error(
                    `Discord SDK の初期化が ${timeoutMs} ミリ秒以内に完了しませんでした（Activity 外で開いていないか、URL Mapping の設定を確認してください）`,
                ),
            );
        }, timeoutMs);

        promise.then(resolve, reject).finally(() => clearTimeout(timer));
    });
}
