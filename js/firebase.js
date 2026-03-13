// ─────────────────────────────────────────────
//  LabChess — Firebase Module
//  Handles all Firebase Realtime Database
//  operations: creating rooms, joining rooms,
//  syncing moves, and listening for changes.
// ─────────────────────────────────────────────

import {
  ref,
  set,
  get,
  update,
  onValue,
  off,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ── DB reference (set by index.html firebase-ready event) ──

let db = null;

// Handle case where firebase-ready already fired before this module loaded
function initDB() {
  if (window._firebaseDB) {
    db = window._firebaseDB;
    console.log("[Firebase] Ready");
  } else {
    window.addEventListener("firebase-ready", () => {
      db = window._firebaseDB;
      console.log("[Firebase] Ready");
    });
  }
}

initDB();

function getDB() {
  if (!db && window._firebaseDB) db = window._firebaseDB;
  if (!db) throw new Error("Firebase DB not initialized yet.");
  return db;
}

// ─────────────────────────────────────────────
//  ROOM STRUCTURE in Firebase:
//
//  games/{roomCode}/
//    ├── fen        — current board FEN string
//    ├── turn       — "w" or "b"
//    ├── status     — "waiting" | "active" | "done"
//    ├── winner     — "w" | "b" | "draw" | null
//    ├── hostColor  — "white" | "black"
//    ├── moves      — [ "e4", "e5", "Nf3", ... ]
//    ├── createdAt  — server timestamp
//    └── lastMove   — { from, to, san }
// ─────────────────────────────────────────────

const GAMES_PATH = "games";

// ── Helpers ──────────────────────────────────

function roomRef(roomCode) {
  return ref(getDB(), `${GAMES_PATH}/${roomCode}`);
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I confusion
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ─────────────────────────────────────────────
//  CREATE GAME
//  Creates a new room in Firebase and returns
//  the generated room code.
// ─────────────────────────────────────────────

export async function createGame(hostColor = "white") {
  const roomCode = generateRoomCode();
  const gameData = {
    fen:       "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", // start position
    turn:      "w",
    status:    "waiting",
    winner:    null,
    hostColor,
    moves:     [],
    createdAt: serverTimestamp(),
    lastMove:  null,
  };

  await set(roomRef(roomCode), gameData);
  console.log(`[Firebase] Game created: ${roomCode}`);
  return roomCode;
}

// ─────────────────────────────────────────────
//  JOIN GAME
//  Checks if the room exists and is joinable,
//  then sets status to "active".
//  Returns the game data or throws an error.
// ─────────────────────────────────────────────

export async function joinGame(roomCode) {
  const code = roomCode.trim().toUpperCase();
  const snapshot = await get(roomRef(code));

  if (!snapshot.exists()) {
    throw new Error("Room not found. Check the code and try again.");
  }

  const game = snapshot.val();

  if (game.status === "active") {
    throw new Error("Game already has two players.");
  }

  if (game.status === "done") {
    throw new Error("This game has already ended.");
  }

  // Mark as active (second player joined)
  await update(roomRef(code), { status: "active" });

  console.log(`[Firebase] Joined game: ${code}`);
  return { roomCode: code, game };
}

// ─────────────────────────────────────────────
//  PUSH MOVE
//  Writes the new board state after a move.
// ─────────────────────────────────────────────

export async function pushMove(roomCode, { fen, turn, san, from, to, moves }) {
  await update(roomRef(roomCode), {
    fen,
    turn,
    lastMove: { from, to, san },
    moves,
  });
}

// ─────────────────────────────────────────────
//  SET GAME RESULT
//  Called when game ends (checkmate / resign / draw)
// ─────────────────────────────────────────────

export async function setGameResult(roomCode, winner) {
  // winner: "w" | "b" | "draw"
  await update(roomRef(roomCode), {
    status: "done",
    winner,
  });
}

// ─────────────────────────────────────────────
//  LISTEN TO GAME
//  Subscribes to real-time changes on a room.
//  Calls callback(gameData) on every change.
//  Returns an unsubscribe function.
// ─────────────────────────────────────────────

export function listenToGame(roomCode, callback) {
  const r = roomRef(roomCode);

  const handler = (snapshot) => {
    if (!snapshot.exists()) return;
    callback(snapshot.val());
  };

  onValue(r, handler);

  // Return cleanup function
  return () => off(r, "value", handler);
}

// ─────────────────────────────────────────────
//  LISTEN FOR OPPONENT JOIN
//  One-shot listener — fires when status
//  changes from "waiting" to "active".
// ─────────────────────────────────────────────

export function waitForOpponent(roomCode, callback) {
  const r = roomRef(roomCode);

  const handler = (snapshot) => {
    if (!snapshot.exists()) return;
    const game = snapshot.val();
    if (game.status === "active") {
      off(r, "value", handler); // unsubscribe after first trigger
      callback(game);
    }
  };

  onValue(r, handler);
}

// ─────────────────────────────────────────────
//  GET GAME (one-time fetch)
// ─────────────────────────────────────────────

export async function getGame(roomCode) {
  const snapshot = await get(roomRef(roomCode));
  if (!snapshot.exists()) return null;
  return snapshot.val();
}