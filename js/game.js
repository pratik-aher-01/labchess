// ─────────────────────────────────────────────
//  LabChess — Game Logic Module
// ─────────────────────────────────────────────

import { pushMove, setGameResult, listenToGame } from "./firebase.js";
import { renderPosition, highlightLastMove, clearHighlights, highlightCheck, flipBoard, showOverlay } from "./board.js";
import { updateStatusBar, updateMoveHistory, updatePlayerBars, showToast } from "./ui.js";

const state = {
  chess:       null,
  roomCode:    null,
  myColor:     null,
  isMyTurn:    false,
  moveHistory: [],
  unsubscribe: null,
  gameOver:    false,
};

// ── Highlight king red when in check ──
function updateCheckHighlight() {
  document.querySelectorAll(".highlight-check")
    .forEach(el => el.classList.remove("highlight-check"));

  if (!state.chess || !state.chess.in_check()) return;

  const board     = state.chess.board();
  const turnColor = state.chess.turn();

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c];
      if (sq && sq.type === "k" && sq.color === turnColor) {
        const file = "abcdefgh"[c];
        const rank = 8 - r;
        highlightCheck(`${file}${rank}`);
        return;
      }
    }
  }
}

export function initGame(roomCode, myColor, initialFen) {
  state.chess          = new Chess(initialFen || undefined);
  window._labchess_fen = state.chess.fen();
  state.roomCode       = roomCode;
  state.myColor        = myColor;
  state.moveHistory    = [];
  state.gameOver       = false;
  state.isMyTurn       = (myColor === "white");

  if (myColor === "black") flipBoard();

  updatePlayerBars(myColor);
  updateStatusBar(state.chess, state.isMyTurn, myColor);
  state.unsubscribe = listenToGame(roomCode, onRemoteUpdate);

  console.log(`[Game] Initialized | Room: ${roomCode} | Color: ${myColor}`);
}

function onRemoteUpdate(gameData) {
  if (!state.chess || state.gameOver) return;

  const remoteFen   = gameData.fen;
  const currentFen  = state.chess.fen();
  const remoteColor = gameData.turn === "w" ? "white" : "black";

  if (remoteFen !== currentFen && remoteColor === state.myColor) {
    clearHighlights();
    state.chess.load(remoteFen);
    state.moveHistory    = gameData.moves || [];
    state.isMyTurn       = true;
    window._labchess_fen = state.chess.fen();

    renderPosition(remoteFen);

    if (gameData.lastMove) {
      highlightLastMove(gameData.lastMove.from, gameData.lastMove.to);
    }

    updateCheckHighlight();

    updateMoveHistory(state.moveHistory);
    updateStatusBar(state.chess, state.isMyTurn, state.myColor);
    updatePlayerBars(state.myColor, state.chess);
    checkGameOver(gameData);
  }

  if (gameData.status === "done" && !state.gameOver) {
    handleGameOver(gameData.winner);
  }
}

export function tryMove(from, to, promotionPiece = "q") {
  if (!state.isMyTurn || state.gameOver) return false;

  const move = state.chess.move({ from, to, promotion: promotionPiece });
  if (!move) return false;

  state.isMyTurn       = false;
  state.moveHistory.push(move.san);
  window._labchess_fen = state.chess.fen();

  highlightLastMove(from, to);
  updateCheckHighlight();

  updateMoveHistory(state.moveHistory);
  updateStatusBar(state.chess, state.isMyTurn, state.myColor);
  updatePlayerBars(state.myColor, state.chess);

  const turn = state.chess.turn();
  pushMove(state.roomCode, {
    fen: state.chess.fen(), turn, san: move.san, from, to, moves: state.moveHistory,
  }).catch(err => {
    console.error("[Game] Failed to push move:", err);
    showToast("Connection error. Move may not have synced.", "error");
  });

  const isOver = checkGameOver(null);
  if (isOver) {
    const winner = state.chess.in_checkmate()
      ? (state.myColor === "white" ? "w" : "b")
      : "draw";
    setGameResult(state.roomCode, winner).catch(console.error);
  }

  return true;
}

export function getLegalMovesForSquare(square) {
  if (!state.chess || !state.isMyTurn) return [];
  const moves = state.chess.moves({ square, verbose: true });
  return moves.map(m => ({ to: m.to, isCapture: m.flags.includes("c") || m.flags.includes("e") }));
}

export function isMyPiece(square) {
  if (!state.chess || !state.isMyTurn) return false;
  const piece = state.chess.get(square);
  if (!piece) return false;
  return piece.color === (state.myColor === "white" ? "w" : "b");
}

function checkGameOver(gameData) {
  if (!state.chess) return false;
  if (gameData?.status === "done") { handleGameOver(gameData.winner); return true; }
  if (state.chess.game_over()) {
    state.gameOver = true;
    const winner = state.chess.in_checkmate()
      ? (state.chess.turn() === "w" ? "b" : "w")
      : "draw";
    handleGameOver(winner);
    return true;
  }
  return false;
}

function handleGameOver(winner) {
  if (state.gameOver) return;
  state.gameOver = true;
  state.isMyTurn = false;

  if (state.unsubscribe) { state.unsubscribe(); state.unsubscribe = null; }

  const myColorChar = state.myColor === "white" ? "w" : "b";
  let emoji, title, sub;

  if (winner === "draw") {
    emoji = "🤝"; title = "It's a Draw!"; sub = "Well played by both sides";
  } else if (winner === myColorChar) {
    emoji = "👑"; title = "You Win!"; sub = state.chess?.in_checkmate() ? "Checkmate!" : "Opponent resigned";
  } else {
    emoji = "💀"; title = "You Lose"; sub = state.chess?.in_checkmate() ? "Checkmate" : "Opponent won";
  }

  showOverlay(emoji, title, sub);
  updateStatusBar(state.chess, false, state.myColor, { gameOver: true, winner });
}

export function resign() {
  if (state.gameOver) return;
  const winner = state.myColor === "white" ? "b" : "w";
  setGameResult(state.roomCode, winner)
    .then(() => handleGameOver(winner))
    .catch(err => { showToast("Could not resign. Try again.", "error"); });
}

export function needsPromotion(from, to) {
  if (!state.chess) return false;
  const piece = state.chess.get(from);
  if (!piece || piece.type !== "p") return false;
  const rank = to[1];
  return (piece.color === "w" && rank === "8") || (piece.color === "b" && rank === "1");
}

export function getState()       { return state; }
export function getChess()       { return state.chess; }
export function getMyColor()     { return state.myColor; }
export function isMyTurn()       { return state.isMyTurn; }
export function isGameOver()     { return state.gameOver; }
export function getMoveHistory() { return state.moveHistory; }