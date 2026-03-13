// ─────────────────────────────────────────────
//  LabChess — Game Logic Module
//  Wraps chess.js for move validation, game
//  state management, and turn control.
//  Acts as the single source of truth for
//  the current game state in the browser.
// ─────────────────────────────────────────────

import { pushMove, setGameResult, listenToGame } from "./firebase.js";
import { renderPosition, highlightLastMove, clearHighlights, showLegalMoves, clearLegalMoves, flipBoard, showOverlay } from "./board.js";
import { updateStatusBar, updateMoveHistory, updatePlayerBars, showToast } from "./ui.js";

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────

const state = {
  chess:       null,      // chess.js instance
  roomCode:    null,      // current room code
  myColor:     null,      // "white" | "black"
  isMyTurn:    false,     // can I move right now?
  moveHistory: [],        // SAN move list
  unsubscribe: null,      // firebase listener cleanup
  gameOver:    false,
};

// ─────────────────────────────────────────────
//  INIT GAME
//  Called after both players are in the room.
// ─────────────────────────────────────────────

export function initGame(roomCode, myColor, initialFen) {
  state.chess       = new Chess(initialFen || undefined);
  window._labchess_fen = state.chess.fen();
  state.roomCode    = roomCode;
  state.myColor     = myColor;
  state.moveHistory = [];
  state.gameOver    = false;
  state.isMyTurn    = (myColor === "white"); // white always goes first

  // Flip board if playing as black
  if (myColor === "black") {
    flipBoard();
  }

  // Update UI
  updatePlayerBars(myColor);
  updateStatusBar(state.chess, state.isMyTurn, myColor);

  // Start listening to Firebase for opponent moves
  state.unsubscribe = listenToGame(roomCode, onRemoteUpdate);

  console.log(`[Game] Initialized | Room: ${roomCode} | Color: ${myColor}`);
}

// ─────────────────────────────────────────────
//  HANDLE REMOTE UPDATE
//  Fired by Firebase listener on every DB change.
//  Applies opponent's move to local chess.js.
// ─────────────────────────────────────────────

function onRemoteUpdate(gameData) {
  if (!state.chess || state.gameOver) return;

  const remoteFen   = gameData.fen;
  const currentFen  = state.chess.fen();
  const remoteColor = gameData.turn === "w" ? "white" : "black"; // whose turn it is NOW (after the move)

  // Only process if FEN actually changed and it's now MY turn
  // (meaning the opponent just moved and it's my turn)
  if (remoteFen !== currentFen && remoteColor === state.myColor) {
    // Load the new position
    state.chess.load(remoteFen);
    state.moveHistory = gameData.moves || [];
    state.isMyTurn    = true;

    // Highlight opponent's last move
    if (gameData.lastMove) {
      highlightLastMove(gameData.lastMove.from, gameData.lastMove.to);
    }

    // Update UI
    updateMoveHistory(state.moveHistory);
    updateStatusBar(state.chess, state.isMyTurn, state.myColor);
    updatePlayerBars(state.myColor, state.chess);

    // Check for game-ending conditions
    checkGameOver(gameData);
  }

  // Handle game over set by opponent (e.g. resign)
  if (gameData.status === "done" && !state.gameOver) {
    handleGameOver(gameData.winner);
  }
}

// ─────────────────────────────────────────────
//  TRY MOVE
//  Called by board.js when user drags a piece.
//  Returns true if move is legal, false otherwise.
// ─────────────────────────────────────────────

export function tryMove(from, to, promotionPiece = "q") {
  if (!state.isMyTurn || state.gameOver) return false;

  const move = state.chess.move({
    from,
    to,
    promotion: promotionPiece,
  });

  if (!move) return false; // illegal move
  window._labchess_fen = state.chess.fen();

  // Move accepted — update state
  state.isMyTurn = false;
  state.moveHistory.push(move.san);

  // Highlight the move
  highlightLastMove(from, to);

  // Update UI immediately (optimistic)
  updateMoveHistory(state.moveHistory);
  updateStatusBar(state.chess, state.isMyTurn, state.myColor);
  updatePlayerBars(state.myColor, state.chess);

  // Push to Firebase
  const turn = state.chess.turn(); // "w" or "b" — whose turn it is now
  pushMove(state.roomCode, {
    fen:   state.chess.fen(),
    turn,
    san:   move.san,
    from,
    to,
    moves: state.moveHistory,
  }).catch(err => {
    console.error("[Game] Failed to push move:", err);
    showToast("Connection error. Move may not have synced.", "error");
  });

  // Check if this move ended the game
  const isOver = checkGameOver(null);
  if (isOver) {
    // Determine winner
    let winner = null;
    if (state.chess.in_checkmate()) {
      winner = state.myColor === "white" ? "w" : "b";
    } else {
      winner = "draw";
    }
    setGameResult(state.roomCode, winner).catch(console.error);
  }

  return true;
}

// ─────────────────────────────────────────────
//  GET LEGAL MOVES FOR SQUARE
//  Returns array of target squares for a piece.
// ─────────────────────────────────────────────

export function getLegalMovesForSquare(square) {
  if (!state.chess || !state.isMyTurn) return [];
  const moves = state.chess.moves({ square, verbose: true });
  return moves.map(m => ({ to: m.to, isCapture: m.flags.includes("c") || m.flags.includes("e") }));
}

// ─────────────────────────────────────────────
//  IS MY PIECE
//  Checks if the piece on a square belongs to me.
// ─────────────────────────────────────────────

export function isMyPiece(square) {
  if (!state.chess || !state.isMyTurn) return false;
  const piece = state.chess.get(square);
  if (!piece) return false;
  const myColorChar = state.myColor === "white" ? "w" : "b";
  return piece.color === myColorChar;
}

// ─────────────────────────────────────────────
//  CHECK GAME OVER
//  Returns true if game has ended.
//  Shows overlay and pushes result if local move caused it.
// ─────────────────────────────────────────────

function checkGameOver(gameData) {
  if (!state.chess) return false;

  // If Firebase says game is done
  if (gameData?.status === "done") {
    handleGameOver(gameData.winner);
    return true;
  }

  // Check local chess.js state
  if (state.chess.game_over()) {
    state.gameOver = true;

    if (state.chess.in_checkmate()) {
      // The side that just moved won
      const winner = state.chess.turn() === "w" ? "b" : "w"; // turn flips after move
      handleGameOver(winner);
    } else if (state.chess.in_draw()) {
      handleGameOver("draw");
    } else if (state.chess.in_stalemate()) {
      handleGameOver("draw");
    }
    return true;
  }

  return false;
}

// ─────────────────────────────────────────────
//  HANDLE GAME OVER
//  Shows the result overlay on the board.
// ─────────────────────────────────────────────

function handleGameOver(winner) {
  if (state.gameOver) return;
  state.gameOver   = true;
  state.isMyTurn   = false;

  // Clean up Firebase listener
  if (state.unsubscribe) {
    state.unsubscribe();
    state.unsubscribe = null;
  }

  const myColorChar = state.myColor === "white" ? "w" : "b";
  let emoji, title, sub;

  if (winner === "draw") {
    emoji = "🤝";
    title = "It's a Draw!";
    sub   = "Well played by both sides";
  } else if (winner === myColorChar) {
    emoji = "👑";
    title = "You Win!";
    sub   = state.chess?.in_checkmate() ? "Checkmate!" : "Opponent resigned";
  } else {
    emoji = "💀";
    title = "You Lose";
    sub   = state.chess?.in_checkmate() ? "Checkmate" : "Opponent won";
  }

  showOverlay(emoji, title, sub);
  updateStatusBar(state.chess, false, state.myColor, { gameOver: true, winner });
}

// ─────────────────────────────────────────────
//  RESIGN
//  Called when user clicks the Resign button.
// ─────────────────────────────────────────────

export function resign() {
  if (state.gameOver) return;
  const winner = state.myColor === "white" ? "b" : "w";
  setGameResult(state.roomCode, winner)
    .then(() => handleGameOver(winner))
    .catch(err => {
      console.error("[Game] Resign failed:", err);
      showToast("Could not resign. Try again.", "error");
    });
}

// ─────────────────────────────────────────────
//  NEEDS PROMOTION
//  Check if a move requires pawn promotion.
// ─────────────────────────────────────────────

export function needsPromotion(from, to) {
  if (!state.chess) return false;
  const piece = state.chess.get(from);
  if (!piece || piece.type !== "p") return false;
  const targetRank = to[1];
  return (piece.color === "w" && targetRank === "8") ||
         (piece.color === "b" && targetRank === "1");
}

// ─────────────────────────────────────────────
//  GETTERS (used by board.js / ui.js)
// ─────────────────────────────────────────────

export function getState()       { return state; }
export function getChess()       { return state.chess; }
export function getMyColor()     { return state.myColor; }
export function isMyTurn()       { return state.isMyTurn; }
export function isGameOver()     { return state.gameOver; }
export function getMoveHistory() { return state.moveHistory; }