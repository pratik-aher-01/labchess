// ─────────────────────────────────────────────
//  LabChess — Game Logic Module (Production-Ready)
//  Handles chess.js state, local & AI validation,
//  audio triggers, victory confetti ribbons,
//  clocks, draw offers, spectators, rematch & replay.
// ─────────────────────────────────────────────

import {
  submitMove,
  resignGame,
  listenToRoom,
  requestOrAcceptRematch,
  offerDraw as fbOfferDraw,
  respondToDraw as fbRespondToDraw,
  claimTimeout,
  getCurrentUser,
  joinAsSpectator,
  listenToSpectators,
  saveSession,
} from "./firebase.js";
import {
  playMoveSound,
  playCaptureSound,
  playCheckSound,
  playGameOverSound,
} from "./audio.js";
import {
  startVictoryConfetti,
  stopConfetti,
} from "./confetti.js";
import {
  renderPosition,
  highlightLastMove,
  clearHighlights,
  highlightCheck,
  setBoardOrientation,
  setBoardReadOnly,
  showOverlay,
  hideOverlay,
} from "./board.js";
import {
  updateStatusBar,
  updateMoveHistory,
  updatePlayerBars,
  updatePresenceIndicators,
  updateRematchState,
  updateClocks,
  updateSpectatorCount,
  updateReplayControls,
  showDrawOfferModal,
  hideDrawOfferModal,
  showToast,
} from "./ui.js";
import { getAiMove } from "./ai.js";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const state = {
  chess: null,
  roomCode: null,
  myColor: null,
  isMyTurn: false,
  moveHistory: [],
  historyFens: [START_FEN],
  historyIndex: -1, // -1 = Live
  historyMoves: [], // [{ from, to }]
  unsubscribe: null,
  unsubscribeSpectators: null,
  gameOver: false,
  gameResult: null,
  players: { white: null, black: null },
  clocks: null,
  clockInterval: null,
  isAiMode: false,
  aiLevel: "medium",
  isSpectator: false,
};

let gameOverModalTimer = null;
// Fix #8: Track the AI first-move timer so it can be cancelled on cleanup
let aiFirstMoveTimer = null;

// ── Highlight King in Check ──
export function updateCheckHighlight() {
  document
    .querySelectorAll(".highlight-check")
    .forEach((el) => el.classList.remove("highlight-check"));

  if (!state.chess || !state.chess.in_check()) return;

  const board = state.chess.board();
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

// ─────────────────────────────────────────────
//  INITIALIZE MULTIPLAYER GAME
// ─────────────────────────────────────────────

export function initGame(roomCode, myColor, initialFen, roomData = null) {
  cleanUpPreviousGame();

  state.isAiMode = false;
  state.isSpectator = false;
  setBoardReadOnly(false);

  state.chess = new Chess(initialFen || undefined);
  window._labchess_fen = state.chess.fen();
  state.roomCode = roomCode;
  state.myColor = myColor;
  state.gameOver = false;
  state.gameResult = null;
  state.historyIndex = -1;
  state.historyFens = [state.chess.fen()];
  state.historyMoves = [];

  const currentTurnChar = state.chess.turn();
  const myColorChar = myColor === "white" ? "w" : "b";
  state.isMyTurn = currentTurnChar === myColorChar;

  state.moveHistory = [];
  if (roomData && roomData.moves) {
    const sortedMoves = Object.values(roomData.moves).sort(
      (a, b) => (a.timestamp || 0) - (b.timestamp || 0)
    );
    state.moveHistory = sortedMoves.map((m) => m.san);
    rebuildHistoryFens(sortedMoves);
  }

  setBoardOrientation(myColor);
  hideOverlay();
  hideDrawOfferModal();
  clearHighlights();

  if (roomData?.players) {
    state.players = roomData.players;
  }

  if (roomData?.game?.clocks) {
    state.clocks = roomData.game.clocks;
    startClockTicker();
  }

  updatePlayerBars(state.myColor, state.players, state.chess);
  updateStatusBar(state.chess, state.isMyTurn, state.myColor);
  updateMoveHistory(state.moveHistory);
  updateCheckHighlight();
  updateReplayControls(state.historyIndex, state.historyFens.length);

  if (roomData?.game?.lastMove) {
    highlightLastMove(roomData.game.lastMove.from, roomData.game.lastMove.to);
  }

  state.unsubscribe = listenToRoom(roomCode, onRemoteUpdate);
  state.unsubscribeSpectators = listenToSpectators(roomCode, (count) => {
    updateSpectatorCount(count);
  });

  console.log(`[Game] Multiplayer Running | Room: ${roomCode} | My Color: ${myColor}`);
}

// ─────────────────────────────────────────────
//  INITIALIZE SPECTATOR MODE
// ─────────────────────────────────────────────

export async function initSpectatorGame(roomCode, spectatorName = "Spectator") {
  cleanUpPreviousGame();

  state.isAiMode = false;
  state.isSpectator = true;
  state.myColor = "spectator";
  state.isMyTurn = false;
  state.roomCode = roomCode;
  state.chess = new Chess();
  state.historyIndex = -1;
  state.historyFens = [START_FEN];
  state.historyMoves = [];

  setBoardReadOnly(true);
  setBoardOrientation("white");
  hideOverlay();
  hideDrawOfferModal();
  clearHighlights();

  await joinAsSpectator(roomCode, spectatorName);

  state.unsubscribe = listenToRoom(roomCode, onRemoteUpdate);
  state.unsubscribeSpectators = listenToSpectators(roomCode, (count) => {
    updateSpectatorCount(count);
  });

  console.log(`[Game] Spectating room ${roomCode}`);
}

// ─────────────────────────────────────────────
//  INITIALIZE SINGLE-PLAYER AI GAME
// ─────────────────────────────────────────────

export function initAiGame(chosenColor = "white", difficulty = "medium", timeSeconds = 0) {
  cleanUpPreviousGame();

  state.isAiMode = true;
  state.aiLevel = difficulty;
  state.isSpectator = false;
  setBoardReadOnly(false);

  let playerColor = chosenColor;
  if (chosenColor === "random") {
    playerColor = Math.random() < 0.5 ? "white" : "black";
  }

  state.myColor = playerColor;
  state.roomCode = "BOT";
  state.chess = new Chess();
  window._labchess_fen = state.chess.fen();
  state.gameOver = false;
  state.gameResult = null;
  state.moveHistory = [];
  state.historyIndex = -1;
  state.historyFens = [START_FEN];
  state.historyMoves = [];

  const timeMs = timeSeconds > 0 ? timeSeconds * 1000 : 0;
  if (timeMs > 0) {
    state.clocks = {
      whiteTimeMs: timeMs,
      blackTimeMs: timeMs,
      lastMoveTime: Date.now(),
    };
    startClockTicker();
  } else {
    state.clocks = null;
  }

  const aiTitle =
    difficulty === "easy"
      ? "Casual Bot (800)"
      : difficulty === "master"
      ? "Master Bot (2000+)"
      : "Club Bot (1400)";

  const playerName = localStorage.getItem("labchess_player_name") || "You";

  state.players = {
    white: { name: playerColor === "white" ? playerName : aiTitle, connected: true },
    black: { name: playerColor === "black" ? playerName : aiTitle, connected: true },
  };

  setBoardOrientation(playerColor);
  renderPosition(START_FEN, false);
  hideOverlay();
  hideDrawOfferModal();
  clearHighlights();

  state.isMyTurn = playerColor === "white";

  updatePlayerBars(state.myColor, state.players, state.chess);
  updateStatusBar(state.chess, state.isMyTurn, state.myColor);
  updateMoveHistory(state.moveHistory);
  updateReplayControls(state.historyIndex, state.historyFens.length);

  // If player chose Black, AI (White) makes the first move!
  // Fix #8: Store the timer ID so cleanUpPreviousGame can cancel it if needed
  if (playerColor === "black") {
    aiFirstMoveTimer = setTimeout(() => {
      aiFirstMoveTimer = null;
      triggerAiMove();
    }, 600);
  }

  console.log(`[Game] AI practice match started | Level: ${difficulty} | Color: ${playerColor}`);
}

// ─────────────────────────────────────────────
//  CLEANUP
// ─────────────────────────────────────────────

export function cleanUpPreviousGame() {
  if (state.unsubscribe) {
    state.unsubscribe();
    state.unsubscribe = null;
  }
  if (state.unsubscribeSpectators) {
    state.unsubscribeSpectators();
    state.unsubscribeSpectators = null;
  }
  stopClockTicker();
  stopConfetti();
  if (gameOverModalTimer) {
    clearTimeout(gameOverModalTimer);
    gameOverModalTimer = null;
  }
  // Fix #8: Cancel any pending first-move AI timer to prevent it firing into the new game
  if (aiFirstMoveTimer) {
    clearTimeout(aiFirstMoveTimer);
    aiFirstMoveTimer = null;
  }

  state.chess = null;
  state.roomCode = null;
  state.myColor = null;
  state.isMyTurn = false;
  state.moveHistory = [];
  state.historyFens = [START_FEN];
  state.historyIndex = -1;
  state.historyMoves = [];
  state.gameOver = false;
  state.gameResult = null;
  state.players = { white: null, black: null };
  state.clocks = null;
  state.isAiMode = false;
  state.isSpectator = false;

  setBoardReadOnly(false);
  hideOverlay();
  hideDrawOfferModal();
  clearHighlights();
  console.log("[Game] Cleanly left game and reset state");
}

export function leaveGame() {
  cleanUpPreviousGame();
}

function rebuildHistoryFens(sortedMoves) {
  const tempChess = new Chess();
  state.historyFens = [tempChess.fen()];
  state.historyMoves = [];

  for (const m of sortedMoves) {
    // Fix #5: Check the return value — skip invalid/corrupted move records
    const result = tempChess.move({ from: m.from, to: m.to, promotion: m.promotion || "q" });
    if (!result) {
      console.warn("[Game] rebuildHistoryFens: skipped invalid move", m);
      continue;
    }
    state.historyFens.push(tempChess.fen());
    state.historyMoves.push({ from: m.from, to: m.to });
  }
}

// ─────────────────────────────────────────────
//  REMOTE REALTIME UPDATE HANDLER
// ─────────────────────────────────────────────

function onRemoteUpdate(roomData) {
  if (!roomData) {
    showToast("This room no longer exists.", "error");
    return;
  }

  const currentUser = getCurrentUser();
  const myUid = currentUser?.uid;

  if (roomData.players) {
    state.players = roomData.players;
    if (currentUser && !state.isSpectator) {
      if (roomData.players.white?.uid === myUid && state.myColor !== "white") {
        state.myColor = "white";
        setBoardOrientation("white");
        if (state.roomCode) {
          saveSession(state.roomCode, "white", roomData.players.white?.name || "Player");
        }
      } else if (roomData.players.black?.uid === myUid && state.myColor !== "black") {
        state.myColor = "black";
        setBoardOrientation("black");
        if (state.roomCode) {
          saveSession(state.roomCode, "black", roomData.players.black?.name || "Player");
        }
      }
    }
    updatePresenceIndicators(state.myColor, state.players);
  }

  updateRematchState(roomData.metadata?.rematchRequestedBy, myUid);

  // Handle Draw Offer State
  const drawOffer = roomData.metadata?.drawOfferedBy;
  if (drawOffer && drawOffer !== myUid && !state.gameOver && !state.isSpectator) {
    showDrawOfferModal();
  } else {
    hideDrawOfferModal();
  }

  const game = roomData.game || {};
  const remoteFen = game.fen;
  const currentFen = state.chess ? state.chess.fen() : "";

  if (game.clocks) {
    // Fix 13: Re-anchor the local clock from the authoritative server values on every
    // remote update. This resets any accumulated drift — each client re-syncs
    // whiteTimeMs/blackTimeMs/lastMoveTime from the server after every move.
    const clocksChanged =
      !state.clocks ||
      state.clocks.whiteTimeMs !== game.clocks.whiteTimeMs ||
      state.clocks.blackTimeMs !== game.clocks.blackTimeMs ||
      state.clocks.lastMoveTime !== game.clocks.lastMoveTime;

    state.clocks = game.clocks;

    if (clocksChanged && !state.gameOver && roomData.metadata?.status === "active") {
      // Restart ticker so elapsed calculation starts fresh from the new server values
      stopClockTicker();
      startClockTicker();
    } else if (!state.clockInterval && !state.gameOver && roomData.metadata?.status === "active") {
      startClockTicker();
    }
  }

  // Handle Rematch Board Reset
  if (roomData.metadata?.status === "active" && state.gameOver && game.status === "in_progress") {
    state.gameOver = false;
    hideOverlay();
    hideDrawOfferModal();
    stopConfetti();
    state.chess = new Chess(remoteFen || undefined);
    state.moveHistory = [];
    state.historyFens = [state.chess.fen()];
    state.historyIndex = -1;
    state.historyMoves = [];
    state.isMyTurn = !state.isSpectator && state.chess.turn() === (state.myColor === "white" ? "w" : "b");
    renderPosition(state.chess.fen(), false);
    clearHighlights();
    updateMoveHistory([]);
    updateStatusBar(state.chess, state.isMyTurn, state.myColor);
    updatePlayerBars(state.myColor, state.players, state.chess);
    updateReplayControls(state.historyIndex, state.historyFens.length);
    if (state.clocks) startClockTicker();
    showToast("Rematch started! Good luck.", "success");
    return;
  }

  // Reconcile incoming moves
  if (remoteFen && remoteFen !== currentFen) {
    state.chess.load(remoteFen);
    window._labchess_fen = remoteFen;

    if (roomData.moves) {
      const sortedMoves = Object.values(roomData.moves).sort(
        (a, b) => (a.timestamp || 0) - (b.timestamp || 0)
      );
      state.moveHistory = sortedMoves.map((m) => m.san);
      rebuildHistoryFens(sortedMoves);
    }

    // If currently viewing live, update board
    if (state.historyIndex === -1) {
      renderPosition(remoteFen);
      if (game.lastMove) {
        highlightLastMove(game.lastMove.from, game.lastMove.to);
      }
    }

    const myColorChar = state.myColor === "white" ? "w" : "b";
    state.isMyTurn = !state.isSpectator && game.turn === myColorChar;

    if (state.chess.in_check()) {
      playCheckSound();
    } else if (game.lastMove?.san?.includes("x")) {
      playCaptureSound();
    } else {
      playMoveSound();
    }

    updateCheckHighlight();
  }

  // Always update status, player bars and controls on every remote update
  updateStatusBar(state.chess, state.isMyTurn, state.myColor);
  updatePlayerBars(state.myColor, state.players, state.chess);
  updateReplayControls(state.historyIndex, state.historyFens.length);

  // Check game termination status
  if (
    (game.status === "checkmate" ||
      game.status === "stalemate" ||
      game.status === "draw" ||
      game.status === "timeout" ||
      game.status === "resigned") &&
    !state.gameOver
  ) {
    let reason = game.status;
    if (game.status === "draw" && state.chess) {
      if (state.chess.in_threefold_repetition()) reason = "threefold_repetition";
      else if (state.chess.insufficient_material()) reason = "insufficient_material";
    }
    handleGameOver(game.winner, reason);
  }
}

// ─────────────────────────────────────────────
//  LOCAL MOVE ATTEMPT
// ─────────────────────────────────────────────

export async function tryMove(from, to, promotionPiece = "q") {
  if (!state.isMyTurn || state.gameOver || !state.chess || state.isSpectator) return false;

  // If viewing historical position, jump to live first!
  if (state.historyIndex !== -1) {
    stepLiveMove();
  }

  const move = state.chess.move({
    from: from.toLowerCase(),
    to: to.toLowerCase(),
    promotion: promotionPiece ? promotionPiece.toLowerCase() : "q",
  });

  if (!move) return false;

  state.isMyTurn = false;
  state.moveHistory.push(move.san);
  state.historyFens.push(state.chess.fen());
  state.historyMoves.push({ from, to });
  window._labchess_fen = state.chess.fen();

  if (state.chess.in_check()) {
    playCheckSound();
  } else if (move.flags.includes("c") || move.flags.includes("e")) {
    playCaptureSound();
  } else {
    playMoveSound();
  }

  highlightLastMove(from, to);
  updateCheckHighlight();
  updateMoveHistory(state.moveHistory);
  updateStatusBar(state.chess, state.isMyTurn, state.myColor);
  updatePlayerBars(state.myColor, state.players, state.chess);
  updateReplayControls(state.historyIndex, state.historyFens.length);

  let isGameOver = false;
  let status = "in_progress";
  let winner = null;

  if (state.chess.in_checkmate()) {
    isGameOver = true;
    status = "checkmate";
    winner = state.myColor === "white" ? "w" : "b";
  } else if (state.chess.in_stalemate()) {
    isGameOver = true;
    status = "stalemate";
    winner = "draw";
  } else if (state.chess.in_threefold_repetition()) {
    isGameOver = true;
    status = "draw";
    winner = "draw";
  } else if (state.chess.insufficient_material()) {
    isGameOver = true;
    status = "draw";
    winner = "draw";
  } else if (state.chess.in_draw()) {
    isGameOver = true;
    status = "draw";
    winner = "draw";
  }

  const nextTurn = state.chess.turn();
  const currentFen = state.chess.fen();

  // Deduct clocks
  // Fix #7: Capture a single timestamp to avoid drift from two Date.now() calls
  let updatedClocks = null;
  if (state.clocks && state.clocks.lastMoveTime) {
    const now = Date.now();
    const elapsed = now - state.clocks.lastMoveTime;
    const movingColor = state.myColor;
    const whiteTime =
      movingColor === "white"
        ? Math.max(0, state.clocks.whiteTimeMs - elapsed)
        : state.clocks.whiteTimeMs;
    const blackTime =
      movingColor === "black"
        ? Math.max(0, state.clocks.blackTimeMs - elapsed)
        : state.clocks.blackTimeMs;

    updatedClocks = {
      whiteTimeMs: whiteTime,
      blackTimeMs: blackTime,
      lastMoveTime: now,
    };
    state.clocks = updatedClocks;
  }

  // Handle AI Mode local execution
  if (state.isAiMode) {
    if (isGameOver) {
      let reason = status;
      if (status === "draw" && state.chess) {
        if (state.chess.in_threefold_repetition()) reason = "threefold_repetition";
        else if (state.chess.insufficient_material()) reason = "insufficient_material";
      }
      handleGameOver(winner, reason);
    } else {
      setTimeout(triggerAiMove, 500);
    }
    return true;
  }

  // Submit to Firebase
  try {
    await submitMove(state.roomCode, {
      fen: currentFen,
      turn: nextTurn,
      san: move.san,
      from,
      to,
      piece: move.piece,
      promotion: move.promotion || null,
      isGameOver,
      winner,
      status,
      clocks: updatedClocks,
    });

    if (isGameOver) {
      let reason = status;
      if (status === "draw" && state.chess) {
        if (state.chess.in_threefold_repetition()) reason = "threefold_repetition";
        else if (state.chess.insufficient_material()) reason = "insufficient_material";
      }
      handleGameOver(winner, reason);
    }
  } catch (err) {
    console.error("[Game] Failed to submit move:", err);
    showToast("Network error: Move failed to sync. Reconnecting...", "error");
  }

  return true;
}

// ─────────────────────────────────────────────
//  AI MOVE TRIGGER
// ─────────────────────────────────────────────

async function triggerAiMove() {
  if (state.gameOver || !state.isAiMode || !state.chess) return;

  const aiColor = state.myColor === "white" ? "b" : "w";
  if (state.chess.turn() !== aiColor) return;

  let bestMove = null;
  try {
    bestMove = await getAiMove(state.chess, state.aiLevel);
  } catch (err) {
    console.warn("[AI] Stockfish evaluation fallback:", err);
  }

  if (!bestMove || state.gameOver || state.chess.turn() !== aiColor) return;

  const move = state.chess.move({
    from: bestMove.from,
    to: bestMove.to,
    promotion: bestMove.promotion || "q",
  });

  if (!move) return;

  // Deduct clocks for AI move
  if (state.clocks && state.clocks.lastMoveTime) {
    const now = Date.now();
    const elapsed = now - state.clocks.lastMoveTime;
    const movingColor = aiColor === "w" ? "white" : "black";
    const whiteTime =
      movingColor === "white"
        ? Math.max(0, state.clocks.whiteTimeMs - elapsed)
        : state.clocks.whiteTimeMs;
    const blackTime =
      movingColor === "black"
        ? Math.max(0, state.clocks.blackTimeMs - elapsed)
        : state.clocks.blackTimeMs;

    state.clocks = {
      whiteTimeMs: whiteTime,
      blackTimeMs: blackTime,
      lastMoveTime: now,
    };
    updateClocks(whiteTime, blackTime, state.myColor);
  }

  state.moveHistory.push(move.san);
  state.historyFens.push(state.chess.fen());
  state.historyMoves.push({ from: bestMove.from, to: bestMove.to });
  window._labchess_fen = state.chess.fen();

  renderPosition(state.chess.fen());
  highlightLastMove(bestMove.from, bestMove.to);

  if (state.chess.in_check()) {
    playCheckSound();
  } else if (move.flags.includes("c") || move.flags.includes("e")) {
    playCaptureSound();
  } else {
    playMoveSound();
  }

  state.isMyTurn = true;
  updateCheckHighlight();
  updateMoveHistory(state.moveHistory);
  updateStatusBar(state.chess, state.isMyTurn, state.myColor);
  updatePlayerBars(state.myColor, state.players, state.chess);
  updateReplayControls(state.historyIndex, state.historyFens.length);

  if (state.chess.in_checkmate()) {
    handleGameOver(aiColor, "checkmate");
  } else if (state.chess.in_stalemate()) {
    handleGameOver("draw", "stalemate");
  } else if (state.chess.in_threefold_repetition()) {
    handleGameOver("draw", "threefold_repetition");
  } else if (state.chess.insufficient_material()) {
    handleGameOver("draw", "insufficient_material");
  } else if (state.chess.in_draw()) {
    handleGameOver("draw", "draw");
  }
}

// ─────────────────────────────────────────────
//  MOVE REPLAY / STEP-THROUGH CONTROLS
// ─────────────────────────────────────────────

export function goToHistoryIndex(idx) {
  if (!state.chess || !state.historyFens || state.historyFens.length === 0) return;

  const maxIdx = state.historyFens.length - 1;
  let targetIdx = idx;

  if (targetIdx < 0 || targetIdx > maxIdx) {
    targetIdx = -1;
  }

  if (targetIdx === -1) {
    // Return to Live position
    state.historyIndex = -1;
    setBoardReadOnly(state.isSpectator);
    renderPosition(state.chess.fen());

    if (state.historyMoves.length > 0) {
      const last = state.historyMoves[state.historyMoves.length - 1];
      highlightLastMove(last.from, last.to);
    } else {
      clearHighlights();
    }
    updateCheckHighlight();
  } else {
    // Reviewing move index (0 <= targetIdx <= maxIdx)
    state.historyIndex = targetIdx;
    setBoardReadOnly(targetIdx !== maxIdx || state.isSpectator);
    const historicalFen = state.historyFens[targetIdx];
    renderPosition(historicalFen);

    // Clear live check highlights when reviewing past position
    document
      .querySelectorAll(".highlight-check")
      .forEach((el) => el.classList.remove("highlight-check"));

    if (targetIdx > 0 && state.historyMoves[targetIdx - 1]) {
      const move = state.historyMoves[targetIdx - 1];
      highlightLastMove(move.from, move.to);
    } else {
      clearHighlights();
    }
  }

  updateReplayControls(state.historyIndex, state.historyFens.length);
}

export function stepFirstMove() {
  if (!state.historyFens || state.historyFens.length <= 1) return;
  goToHistoryIndex(0);
}

export function stepPrevMove() {
  if (!state.historyFens || state.historyFens.length <= 1) return;
  const maxIdx = state.historyFens.length - 1;
  const current = state.historyIndex === -1 ? maxIdx : state.historyIndex;
  // Fix #17: Return early when already at the starting position (index 0)
  if (current <= 0) return;
  goToHistoryIndex(current - 1);
}

export function stepNextMove() {
  if (!state.historyFens || state.historyFens.length <= 1) return;
  const maxIdx = state.historyFens.length - 1;
  if (state.historyIndex === -1 || state.historyIndex >= maxIdx) return;
  const next = state.historyIndex + 1;
  goToHistoryIndex(next);
}

export function stepLiveMove() {
  goToHistoryIndex(-1);
}

export function isViewingHistory() {
  return state.historyIndex !== -1;
}

// ─────────────────────────────────────────────
//  CHESS CLOCK TICKER
// ─────────────────────────────────────────────

function startClockTicker() {
  stopClockTicker();
  state.clockInterval = setInterval(() => {
    if (state.gameOver || !state.clocks || !state.chess) return;

    const turn = state.chess.turn();
    const lastTime = state.clocks.lastMoveTime || Date.now();
    const elapsed = Date.now() - lastTime;

    let whiteRemaining = state.clocks.whiteTimeMs;
    let blackRemaining = state.clocks.blackTimeMs;

    if (turn === "w") {
      whiteRemaining = Math.max(0, whiteRemaining - elapsed);
    } else {
      blackRemaining = Math.max(0, blackRemaining - elapsed);
    }

    updateClocks(whiteRemaining, blackRemaining, state.myColor);

    if (whiteRemaining <= 0 && turn === "w") {
      stopClockTicker();
      if (state.isAiMode) {
        handleGameOver("b", "timeout");
      } else if (!state.isSpectator) {
        claimTimeout(state.roomCode, "black");
      }
    } else if (blackRemaining <= 0 && turn === "b") {
      stopClockTicker();
      if (state.isAiMode) {
        handleGameOver("w", "timeout");
      } else if (!state.isSpectator) {
        claimTimeout(state.roomCode, "white");
      }
    }
  }, 250);
}

function stopClockTicker() {
  if (state.clockInterval) {
    clearInterval(state.clockInterval);
    state.clockInterval = null;
  }
}

// ─────────────────────────────────────────────
//  GAME OVER HANDLER (WITH VICTORY CONFETTI)
// ─────────────────────────────────────────────

function handleGameOver(winner, statusReason) {
  if (state.gameOver) return;
  state.gameOver = true;
  state.gameResult = winner; // Fix #19: persist for PGN export
  state.isMyTurn = false;
  stopClockTicker();

  if (gameOverModalTimer) {
    clearTimeout(gameOverModalTimer);
    gameOverModalTimer = null;
  }

  const myColorChar = state.myColor === "white" ? "w" : "b";
  const isWin = winner === myColorChar;
  playGameOverSound(isWin);

  let emoji = "🤝";
  let title = "Game Drawn";
  let sub = "Well played by both sides";

  if (winner === "draw") {
    emoji = "🤝";
    if (statusReason === "stalemate") {
      title = "Stalemate!";
      sub = "No legal moves remaining";
    } else if (statusReason === "threefold_repetition") {
      title = "Draw by Repetition";
      sub = "Position occurred 3 times";
    } else if (statusReason === "insufficient_material") {
      title = "Draw (Insufficient Material)";
      sub = "Neither side has mating material";
    } else if (statusReason === "draw") {
      title = "Draw Agreed";
      sub = "Draw by mutual agreement";
    } else {
      title = "Game Drawn";
      sub = "Game ended in a draw";
    }
    stopConfetti();
  } else if (isWin) {
    emoji = "👑";
    title = "Victory!";
    if (statusReason === "resigned") sub = "Opponent resigned";
    else if (statusReason === "timeout") sub = "Opponent ran out of time";
    else sub = "Checkmate! Brilliant victory";
  } else {
    emoji = "💀";
    title = "Defeat";
    if (statusReason === "resigned") sub = "You resigned";
    else if (statusReason === "timeout") sub = "You ran out of time";
    else sub = "Checkmate";
    stopConfetti();
  }

  // Update status bar & keep the checkmate / check glow visible immediately
  updateStatusBar(state.chess, false, state.myColor, { gameOver: true, winner });
  updateCheckHighlight();

  // Delay before showing the game over modal:
  // - 1500ms on Checkmate so players can clearly see the checkmating move, attacking pieces, and trapped king
  // - 1000ms on Stalemate / Repetition
  // - 350ms on Resign / Timeout
  const modalDelay =
    statusReason === "checkmate" ? 1500 : statusReason === "stalemate" ? 1000 : 350;

  gameOverModalTimer = setTimeout(() => {
    if (!state.gameOver) return;

    if (isWin && winner !== "draw") {
      startVictoryConfetti(6000);
    }

    showOverlay(emoji, title, sub);
  }, modalDelay);
}

// ─────────────────────────────────────────────
//  RESIGN & DRAW
// ─────────────────────────────────────────────

// Fix #4: prevent double-resign if the button is clicked twice before the
// async Firebase call resolves.
let isResigning = false;

export async function resign() {
  if (state.gameOver || isResigning) return;

  if (state.isAiMode) {
    isResigning = true;
    const winner = state.myColor === "white" ? "b" : "w";
    handleGameOver(winner, "resigned");
    showToast("You resigned the game.", "default");
    isResigning = false;
    return;
  }

  if (!state.roomCode) return;
  isResigning = true;
  try {
    await resignGame(state.roomCode, state.myColor);
    const winner = state.myColor === "white" ? "b" : "w";
    handleGameOver(winner, "resigned");
    showToast("You resigned the game.", "default");
  } catch (err) {
    console.error("[Game] Resign failed:", err);
    showToast("Could not resign. Please check connection.", "error");
  } finally {
    isResigning = false;
  }
}

export async function offerDraw() {
  if (state.gameOver) return;

  if (state.isAiMode) {
    showToast("The AI bot declined your draw offer.", "default");
    return;
  }

  if (!state.roomCode) return;
  try {
    await fbOfferDraw(state.roomCode);
    showToast("Draw offer sent to opponent.", "default");
  } catch (err) {
    showToast("Failed to offer draw.", "error");
  }
}

export async function handleDrawResponse(accept) {
  if (!state.roomCode) return;
  try {
    await fbRespondToDraw(state.roomCode, accept);
    hideDrawOfferModal();
    if (!accept) {
      showToast("Draw offer declined.", "default");
    }
  } catch (err) {
    showToast("Error processing draw response.", "error");
  }
}

export async function requestRematch() {
  if (state.isAiMode) {
    initAiGame(state.myColor, state.aiLevel, state.clocks ? state.clocks.whiteTimeMs / 1000 : 0);
    return;
  }

  if (!state.roomCode) return;
  try {
    const updatedRoom = await requestOrAcceptRematch(state.roomCode, state.myColor);

    // Fix 16: When the rematch transaction fully committed (both sides agreed),
    // immediately update local color/orientation from the snapshot so the
    // board doesn't briefly show the wrong side while waiting for onRemoteUpdate.
    if (
      updatedRoom?.metadata?.rematchRequestedBy === null &&
      updatedRoom?.game?.status === "in_progress"
    ) {
      const myUid = getCurrentUser()?.uid;
      if (updatedRoom.players?.white?.uid === myUid && state.myColor !== "white") {
        state.myColor = "white";
        setBoardOrientation("white");
        if (state.roomCode) saveSession(state.roomCode, "white", updatedRoom.players.white?.name || "Player");
      } else if (updatedRoom.players?.black?.uid === myUid && state.myColor !== "black") {
        state.myColor = "black";
        setBoardOrientation("black");
        if (state.roomCode) saveSession(state.roomCode, "black", updatedRoom.players.black?.name || "Player");
      }
    } else {
      showToast("Rematch request sent to opponent.", "success");
    }
  } catch (err) {
    console.error("[Game] Rematch request failed:", err);
    showToast("Could not request rematch.", "error");
  }
}

// ─────────────────────────────────────────────
//  PGN & FEN EXPORT
// ─────────────────────────────────────────────

export function getPGN() {
  if (!state.chess) return "";
  const whiteName = state.players.white?.name || "White";
  const blackName = state.players.black?.name || "Black";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, ".");

  // Fix #19: Derive the correct PGN Result tag from actual game outcome
  let resultTag = "*";
  if (state.gameOver && state.gameResult) {
    if (state.gameResult === "draw") resultTag = "1/2-1/2";
    else if (state.gameResult === "w") resultTag = "1-0";
    else if (state.gameResult === "b") resultTag = "0-1";
  }

  let pgn = `[Event "LabChess Game"]\n`;
  pgn += `[Site "LabChess"]\n`;
  pgn += `[Date "${date}"]\n`;
  pgn += `[White "${whiteName}"]\n`;
  pgn += `[Black "${blackName}"]\n`;
  pgn += `[Result "${resultTag}"]\n\n`;

  for (let i = 0; i < state.moveHistory.length; i += 2) {
    const moveNum = Math.floor(i / 2) + 1;
    const w = state.moveHistory[i];
    const b = state.moveHistory[i + 1] || "";
    pgn += `${moveNum}. ${w} ${b} `.trim() + "\n";
  }

  return pgn.trim();
}

export function getFEN() {
  return state.chess ? state.chess.fen() : "";
}

// ─────────────────────────────────────────────
//  LEGAL MOVES & HELPERS
// ─────────────────────────────────────────────

export function getLegalMovesForSquare(square) {
  if (!state.chess || !state.isMyTurn || state.gameOver || state.isSpectator) return [];
  const moves = state.chess.moves({ square, verbose: true });
  return moves.map((m) => ({
    to: m.to,
    isCapture: m.flags.includes("c") || m.flags.includes("e"),
  }));
}

export function isMyPiece(square) {
  if (!state.chess || !state.isMyTurn || state.gameOver || state.isSpectator) return false;
  const piece = state.chess.get(square);
  if (!piece) return false;
  return piece.color === (state.myColor === "white" ? "w" : "b");
}

export function needsPromotion(from, to) {
  if (!state.chess) return false;
  const piece = state.chess.get(from);
  if (!piece || piece.type !== "p") return false;
  const rank = to[1];
  return (
    (piece.color === "w" && rank === "8") ||
    (piece.color === "b" && rank === "1")
  );
}

export function getState() { return state; }
export function getChess() { return state.chess; }
export function getPiece(square) {
  if (!state.chess || !square) return null;
  return state.chess.get(square);
}
export function getMyColor() { return state.myColor; }
export function isMyTurn() { return state.isMyTurn; }
export function isGameOver() { return state.gameOver; }
export function getMoveHistory() { return state.moveHistory; }