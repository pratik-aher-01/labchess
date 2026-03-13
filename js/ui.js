// ─────────────────────────────────────────────
//  LabChess — UI Module
//  Handles screen transitions, lobby actions,
//  room code flow, status updates, move history,
//  player bars, toast notifications, and
//  all button event listeners.
// ─────────────────────────────────────────────

import { createGame, joinGame, waitForOpponent } from "./firebase.js";
import { initGame, resign, getChess, getMoveHistory } from "./game.js";
import { initBoard } from "./board.js";

// ─────────────────────────────────────────────
//  SCREEN MANAGEMENT
// ─────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id)?.classList.add("active");
}

// ─────────────────────────────────────────────
//  TOAST NOTIFICATIONS
// ─────────────────────────────────────────────

let toastTimer = null;

export function showToast(message, type = "default", duration = 3000) {
  const toast = document.getElementById("toast");
  if (!toast) return;

  toast.textContent = message;
  toast.className   = `toast ${type}`;

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, duration);
}

// ─────────────────────────────────────────────
//  LOBBY — COLOR SELECTION
// ─────────────────────────────────────────────

let selectedColor = "white";

document.querySelectorAll(".color-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".color-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    selectedColor = btn.dataset.color;
  });
});

// ─────────────────────────────────────────────
//  LOBBY — CREATE GAME
// ─────────────────────────────────────────────

document.getElementById("btn-create")?.addEventListener("click", async () => {
  const btn = document.getElementById("btn-create");
  btn.disabled    = true;
  btn.textContent = "Creating...";

  try {
    const roomCode = await createGame(selectedColor);

    // Show waiting screen with room code
    document.getElementById("display-room-code").textContent = roomCode;
    document.getElementById("header-room-code").textContent  = roomCode;
    showScreen("waiting-screen");

    // Wait for opponent to join
    waitForOpponent(roomCode, (gameData) => {
      const myColor = gameData.hostColor; // host keeps their chosen color
      startGame(roomCode, myColor, gameData.fen);
    });

  } catch (err) {
    console.error("[UI] Create game error:", err);
    showToast("Failed to create game. Check your connection.", "error");
  } finally {
    btn.disabled    = false;
    btn.textContent = "Create Game";
  }
});

// ─────────────────────────────────────────────
//  LOBBY — JOIN GAME
// ─────────────────────────────────────────────

document.getElementById("btn-join")?.addEventListener("click", handleJoin);
document.getElementById("join-code-input")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleJoin();
});

// Auto-uppercase input as user types
document.getElementById("join-code-input")?.addEventListener("input", (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

async function handleJoin() {
  const input = document.getElementById("join-code-input");
  const btn   = document.getElementById("btn-join");
  const code  = input?.value.trim().toUpperCase();

  if (!code || code.length !== 6) {
    showToast("Enter a valid 6-character room code.", "error");
    input?.focus();
    return;
  }

  btn.disabled    = true;
  btn.textContent = "Joining...";

  try {
    const { roomCode, game } = await joinGame(code);

    // Joiner gets the opposite color of the host
    const myColor = game.hostColor === "white" ? "black" : "white";

    document.getElementById("header-room-code").textContent = roomCode;
    startGame(roomCode, myColor, game.fen);

  } catch (err) {
    console.error("[UI] Join game error:", err);
    showToast(err.message || "Could not join game.", "error");
  } finally {
    btn.disabled    = false;
    btn.textContent = "Join Game";
  }
}

// ─────────────────────────────────────────────
//  WAITING SCREEN — COPY CODE
// ─────────────────────────────────────────────

document.getElementById("btn-copy-code")?.addEventListener("click", () => {
  const code = document.getElementById("display-room-code")?.textContent;
  if (!code || code === "——————") return;

  navigator.clipboard.writeText(code)
    .then(() => {
      const btn = document.getElementById("btn-copy-code");
      btn.textContent = "Copied!";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = "Copy Code";
        btn.classList.remove("copied");
      }, 2000);
    })
    .catch(() => showToast("Could not copy. Select the code manually.", "error"));
});

// ─────────────────────────────────────────────
//  GAME SCREEN — RESIGN
// ─────────────────────────────────────────────

document.getElementById("btn-resign")?.addEventListener("click", () => {
  const confirmed = confirm("Are you sure you want to resign?");
  if (confirmed) resign();
});

// ─────────────────────────────────────────────
//  START GAME
//  Transitions to game screen and initializes
//  the board + game logic.
// ─────────────────────────────────────────────

function startGame(roomCode, myColor, fen) {
  showScreen("game-screen");
  initBoard(fen || "start");
  initGame(roomCode, myColor, fen);
  showToast(`Game started! You are playing as ${myColor}.`, "success", 4000);
}

// ─────────────────────────────────────────────
//  UPDATE STATUS BAR
//  Shows whose turn it is and move count.
// ─────────────────────────────────────────────

export function updateStatusBar(chess, isMyTurn, myColor, opts = {}) {
  const turnText = document.getElementById("turn-text");
  const turnDot  = document.getElementById("turn-dot");
  const moveCount = document.getElementById("move-count");
  if (!chess) return;

  const history    = chess.history();
  const totalMoves = history.length;
  if (moveCount) moveCount.textContent = totalMoves;

  if (opts.gameOver) {
    if (turnText) turnText.textContent = "Game Over";
    if (turnDot)  {
      turnDot.className = "turn-dot";
    }
    return;
  }

  const currentTurn  = chess.turn(); // "w" or "b"
  const isWhiteTurn  = currentTurn === "w";
  const myColorChar  = myColor === "white" ? "w" : "b";
  const myTurn       = currentTurn === myColorChar;

  if (turnText) {
    if (chess.in_checkmate()) {
      turnText.textContent = "Checkmate!";
    } else if (chess.in_draw()) {
      turnText.textContent = "Draw";
    } else if (chess.in_check()) {
      turnText.textContent = myTurn ? "You are in Check!" : "Opponent in Check";
    } else {
      turnText.textContent = myTurn ? "Your turn" : "Opponent's turn";
    }
  }

  if (turnDot) {
    turnDot.className = `turn-dot ${isWhiteTurn ? "white" : "black"} ${myTurn ? "my-turn" : ""}`;
  }
}

// ─────────────────────────────────────────────
//  UPDATE MOVE HISTORY
//  Renders the move list panel.
// ─────────────────────────────────────────────

export function updateMoveHistory(moves) {
  const list = document.getElementById("move-list");
  if (!list) return;

  list.innerHTML = "";
  moves.forEach((san, i) => {
    const li = document.createElement("li");
    li.textContent = `${i % 2 === 0 ? Math.floor(i / 2) + 1 + ". " : ""}${san}`;
    list.appendChild(li);
  });

  // Scroll to latest move
  list.scrollTop = list.scrollHeight;
}

// ─────────────────────────────────────────────
//  UPDATE PLAYER BARS
//  Updates color tags and captured pieces display.
// ─────────────────────────────────────────────

export function updatePlayerBars(myColor, chess = null) {
  const opponentColor = myColor === "white" ? "black" : "white";

  // Color tags
  const tagMe       = document.getElementById("tag-me");
  const tagOpponent = document.getElementById("tag-opponent");
  if (tagMe)       tagMe.textContent       = myColor.charAt(0).toUpperCase() + myColor.slice(1);
  if (tagOpponent) tagOpponent.textContent = opponentColor.charAt(0).toUpperCase() + opponentColor.slice(1);

  // Avatars
  const avatarMe       = document.getElementById("avatar-me");
  const avatarOpponent = document.getElementById("avatar-opponent");
  if (avatarMe)       avatarMe.textContent       = myColor === "white" ? "♔" : "♚";
  if (avatarOpponent) avatarOpponent.textContent = myColor === "white" ? "♚" : "♔";

  // Captured pieces (material count)
  if (chess) {
    const { mine, theirs } = getCapturedPieces(chess, myColor);
    const capturedMe       = document.getElementById("captured-me");
    const capturedOpponent = document.getElementById("captured-opponent");
    if (capturedMe)       capturedMe.textContent       = mine;
    if (capturedOpponent) capturedOpponent.textContent = theirs;
  }
}

// ─────────────────────────────────────────────
//  CAPTURED PIECES CALCULATOR
//  Compares piece counts to show material diff.
// ─────────────────────────────────────────────

function getCapturedPieces(chess, myColor) {
  const PIECE_ICONS = {
    white: { p: "♙", n: "♘", b: "♗", r: "♖", q: "♕" },
    black: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛" },
  };

  const START_COUNTS = { p: 8, n: 2, b: 2, r: 2, q: 1 };

  // Count pieces currently on board
  const board    = chess.board();
  const onBoard  = { w: { p:0,n:0,b:0,r:0,q:0 }, b: { p:0,n:0,b:0,r:0,q:0 } };

  board.forEach(row => row.forEach(sq => {
    if (sq && sq.type !== "k") {
      onBoard[sq.color][sq.type]++;
    }
  }));

  // Captured = start - on board
  function buildCapturedStr(capturedColor) {
    const icons = PIECE_ICONS[capturedColor];
    let str = "";
    for (const [type, startCount] of Object.entries(START_COUNTS)) {
      const colorChar  = capturedColor === "white" ? "w" : "b";
      const captured   = startCount - onBoard[colorChar][type];
      if (captured > 0) str += icons[type].repeat(captured);
    }
    return str;
  }

  const opponentColor = myColor === "white" ? "black" : "white";

  return {
    mine:   buildCapturedStr(opponentColor), // pieces I captured (opponent's pieces gone)
    theirs: buildCapturedStr(myColor),       // pieces opponent captured (my pieces gone)
  };
}