/**
 * Discord SDK から参加者のアバターを取得し、出入りに追随するフック（要件定義 §7.2）。
 *
 * 誰が座っているか・観戦しているかはサーバーのルーム状態が唯一の正で（要件定義 §5.4）、
 * ここで得るのは表示に添えるアバターだけ。取得に失敗しても対局には影響しないため、
 * 画面は代替表示に切り替えて動作を続ける。
 */

import { Events, type EventPayloadData, type IDiscordSDK } from "@discord/embedded-app-sdk";
import { useEffect, useState } from "react";

import { buildAvatarMap, type AvatarMap } from "./participants.ts";

// アバターが 1 件も無い状態。毎回作り直して再描画を誘発しないよう共有する
const NO_AVATARS: AvatarMap = new Map();

/**
 * Activity に参加している人のアバターを取得する。
 * @param sdk 初期化済みの Discord SDK
 * @returns User ID からアバター画像の URL を引く表
 */
export function useParticipantAvatars(sdk: IDiscordSDK): AvatarMap {
    const [avatars, setAvatars] = useState<AvatarMap>(NO_AVATARS);

    useEffect(() => {
        // StrictMode では effect が 2 回走るため、後片付け後の setState を抑止する
        let active = true;

        const update = (
            event: EventPayloadData<Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE>,
        ): void => {
            if (active) setAvatars(buildAvatarMap(event.participants));
        };

        // 参加者の出入りに追随する。購読の可否は SDK 側の応答待ちのため、
        // 初回の一覧は購読とは別に取得する
        void sdk.subscribe(Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, update).catch(ignore);
        void sdk.commands
            .getInstanceConnectedParticipants()
            .then((result) => update(result))
            .catch(ignore);

        return () => {
            active = false;
            void sdk
                .unsubscribe(Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, update)
                .catch(ignore);
        };
    }, [sdk]);

    return avatars;
}

// アバターは表示上の飾りであり、失敗しても代替表示で続けられるため握り潰す
function ignore(): void {}
