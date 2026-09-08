/**
 * ロビー画面（要件定義 §7.2 / F-02・F-03・F-05・F-13）。
 *
 * 何を出すか・何が押せるかの判断は lobbyView.ts が組み立てた結果に従い、
 * ここは描画と操作の呼び出しだけを行う。表記は全文日本語・簡潔にする（要件定義 §7.5）。
 */

import type { Participant } from "@othello/protocol";
import { useState } from "react";

import { buildLobbyView, type ParticipantView, type SeatView } from "./lobbyView.ts";
import { avatarInitial, type AvatarMap } from "./participants.ts";
import type { ClientState } from "./roomState.ts";
import type { GameActions } from "./useGameSession.ts";

/** ロビー画面に渡す値。 */
export type LobbyProps = {
    /** サーバー通知から組み立てた現在の状態 */
    readonly state: ClientState;
    /** 着席・退席・対局開始の操作 */
    readonly actions: GameActions;
    /** User ID からアバター画像の URL を引く表 */
    readonly avatars: AvatarMap;
};

/**
 * ロビー画面を描く。
 * @param props ロビー画面に渡す値
 * @returns 画面の要素
 */
export function Lobby(props: LobbyProps): React.JSX.Element {
    const { state, actions, avatars } = props;
    const view = buildLobbyView(state);
    if (view === null) return <p className="app__status">サーバーに接続しています…</p>;

    return (
        <section className="app__screen">
            <h2 className="app__heading">ロビー</h2>

            <ul className="lobby__seats">
                {view.seats.map((seat) => (
                    <li key={seat.seat} className="lobby__seat">
                        <Seat seat={seat} avatars={avatars} actions={actions} />
                    </li>
                ))}
            </ul>

            <section className="lobby__spectators">
                <h3 className="lobby__subheading">観戦中</h3>
                {view.spectators.length === 0 ? (
                    <p className="lobby__empty">なし</p>
                ) : (
                    <ul className="lobby__spectatorList">
                        {view.spectators.map((spectator) => (
                            <li key={spectator.participant.userId} className="lobby__spectator">
                                <Avatar
                                    participant={spectator.participant}
                                    avatars={avatars}
                                    small
                                />
                                <Name view={spectator} />
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <div className="app__actions">
                <button type="button" disabled={!view.canStart} onClick={actions.startGame}>
                    対局開始
                </button>
            </div>
            {view.startHint !== null && <p className="lobby__hint">{view.startHint}</p>}
        </section>
    );
}

// 座席 1 つ分。着席者かその席が空いていることを示し、着席・退席の操作を添える
function Seat({
    seat,
    avatars,
    actions,
}: {
    readonly seat: SeatView;
    readonly avatars: AvatarMap;
    readonly actions: GameActions;
}): React.JSX.Element {
    return (
        <>
            <span className="lobby__mark" aria-hidden="true">
                {seat.mark}
            </span>
            <span className="lobby__label">{seat.label}</span>
            {seat.occupant === null ? (
                <span className="lobby__vacant">（空席）</span>
            ) : (
                <span className="lobby__occupant">
                    <Avatar participant={seat.occupant} avatars={avatars} />
                    <Name view={{ participant: seat.occupant, mine: seat.mine }} />
                </span>
            )}
            {seat.canLeave ? (
                <button type="button" className="lobby__seatAction" onClick={actions.leaveSeat}>
                    退席
                </button>
            ) : (
                <button
                    type="button"
                    className="lobby__seatAction"
                    disabled={!seat.canSit}
                    onClick={() => actions.takeSeat(seat.seat)}
                >
                    着席
                </button>
            )}
        </>
    );
}

// 表示名。自分自身は一目で分かるように印を添える
function Name({ view }: { readonly view: ParticipantView }): React.JSX.Element {
    return (
        <span className="lobby__name">
            {view.participant.displayName}
            {view.mine && <span className="lobby__you">（あなた）</span>}
        </span>
    );
}

// アバター画像。CDN の画像を読み込めない場合は表示名の頭文字で代替する
function Avatar({
    participant,
    avatars,
    small = false,
}: {
    readonly participant: Participant;
    readonly avatars: AvatarMap;
    readonly small?: boolean;
}): React.JSX.Element {
    const url = avatars.get(participant.userId) ?? null;
    // 読み込みに失敗した URL を覚えておき、別の URL に変わったら改めて試す
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    const className = small ? "lobby__avatar lobby__avatar--small" : "lobby__avatar";

    if (url === null || url === failedUrl) {
        return (
            <span className={`${className} lobby__avatar--fallback`} aria-hidden="true">
                {avatarInitial(participant.displayName)}
            </span>
        );
    }

    return (
        <img
            className={className}
            src={url}
            alt=""
            loading="lazy"
            onError={() => setFailedUrl(url)}
        />
    );
}
