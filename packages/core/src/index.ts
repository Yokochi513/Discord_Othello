/**
 * @othello/core の公開 API。各モジュールの re-export のみを行い、実装は置かない。
 *
 * パッケージ外（server / client）から参照できるのはこのファイルが再エクスポート
 * した要素に限る。core 内部でしか使わない処理は、ここへ載せず各モジュールから
 * 直接 import する。
 */

// 型
export type {
    Cell,
    Coord,
    File,
    Player,
    Rank,
    Square,
    TurnResult,
    GameEndReason,
    Outcome,
    Score,
    GameResult,
} from "./type.js";
export type { Board, CellCount } from "./board.js";
export type { GameState, MoveEntry, MoveLog } from "./game.js";

// 座標系
export { BOARD_SIZE, formatSquare, isSquare, parseSquare } from "./coord.js";

// 盤面
export { countCells, countStones, createInitialBoard, getCell } from "./board.js";

// 手番
export { FIRST_PLAYER, opponent } from "./player.js";

// 合法手
export { isLegalMove, listLegalMoves, hasLegalMove } from "./moves.js";

// 着手の適用
export { listFlips, applyMove, IllegalMoveError } from "./apply.js";

// 手番遷移
export { nextTurn, passedPlayers } from "./turn.js";

// 終局判定
export {
    detectGameEnd,
    isGameOver,
    judgeOutcome,
    finishGame,
    resignGame,
    winnerOf,
} from "./result.js";

// 対局状態と棋譜
export {
    createGameState,
    playMove,
    replayGame,
    restoreGameState,
    InvalidSquareError,
    NotYourTurnError,
} from "./game.js";
