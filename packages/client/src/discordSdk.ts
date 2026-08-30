/**
 * Discord Embedded App SDK の初期化と OAuth2 認証。
 *
 * client secret はサーバー側にのみ保持するため、認可コード（code）の取得はここで行い、
 * アクセストークンへの交換はサーバーの `/api/token` に委ねる（要件定義 §13 / §15）。
 */

import { DiscordSDK, DiscordSDKMock, type IDiscordSDK } from "@discord/embedded-app-sdk";

import { postApiJson } from "./api.ts";
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
 * iframe 内で動作している場合は続けて OAuth2 認証まで行う。
 * iframe 外（ブラウザで直接開いた場合）はモックを使い、認証は行わず開発を継続できるようにする。
 * @param config クライアントの実行時設定
 * @returns 初期化済みのセッション
 */
export async function initDiscordSession(config: ClientConfig): Promise<DiscordSession> {
    const sdk = createSdk(config);
    await withTimeout(sdk.ready(), READY_TIMEOUT_MS);

    if (config.embedded) {
        await authenticate(sdk, config);
    }

    return {
        sdk,
        instanceId: sdk.instanceId,
        embedded: config.embedded,
    };
}

/** サーバーの POST /api/token が返す応答 */
type TokenResponse = {
    readonly access_token: string;
};

// authorize() で認可コードを取得し、サーバーでアクセストークンに交換した上で
// SDK を認証する（本人確認そのものは Discord 側が行う。要件定義 §11.5）
async function authenticate(sdk: IDiscordSDK, config: ClientConfig): Promise<void> {
    const { code } = await sdk.commands.authorize({
        client_id: config.discordClientId,
        response_type: "code",
        scope: ["identify"],
    });

    const { access_token: accessToken } = await postApiJson<TokenResponse>("/api/token", config, {
        code,
    });

    await sdk.commands.authenticate({ access_token: accessToken });
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
