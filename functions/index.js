const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { Chess } = require("chess.js");

admin.initializeApp();
const db = admin.database();

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function generateRoomCode() {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

/**
 * Authoritative move submission function
 */
exports.submitMove = functions.https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
  }

  const { roomCode, from, to, promotion } = data;
  if (!roomCode || !from || !to) {
    throw new functions.https.HttpsError("invalid-argument", "Missing required move parameters.");
  }

  const normalizedRoomCode = roomCode.toUpperCase();
  const uid = context.auth.uid;
  const roomRef = db.ref(`rooms/${normalizedRoomCode}`);
  const snapshot = await roomRef.get();

  if (!snapshot.exists()) {
    throw new functions.https.HttpsError("not-found", "Room does not exist.");
  }

  const room = snapshot.val();
  const metadata = room.metadata || {};
  const players = room.players || {};
  const game = room.game || {};

  if (metadata.status !== "active" || game.status !== "in_progress") {
    throw new functions.https.HttpsError("failed-precondition", "Game is not currently active.");
  }

  let playerColor = null;
  if (players.white && players.white.uid === uid) {
    playerColor = "w";
  } else if (players.black && players.black.uid === uid) {
    playerColor = "b";
  } else {
    throw new functions.https.HttpsError("permission-denied", "You are not a participant in this game.");
  }

  if (game.turn !== playerColor) {
    throw new functions.https.HttpsError("failed-precondition", "It is not your turn.");
  }

  // Authoritative chess validation
  const chess = new Chess(game.fen);
  const moveResult = chess.move({
    from: from.toLowerCase(),
    to: to.toLowerCase(),
    promotion: promotion ? promotion.toLowerCase() : "q",
  });

  if (!moveResult) {
    throw new functions.https.HttpsError("invalid-argument", "Illegal chess move according to official rules.");
  }

  let newGameStatus = "in_progress";
  let winner = null;

  if (chess.in_checkmate()) {
    newGameStatus = "checkmate";
    winner = playerColor; // The player who just moved delivered checkmate
  } else if (chess.in_draw() || chess.in_stalemate() || chess.in_threefold_repetition() || chess.insufficient_material()) {
    newGameStatus = chess.in_stalemate() ? "stalemate" : "draw";
    winner = "draw";
  }

  const nextTurn = chess.turn();
  const nextFen = chess.fen();
  const moveNumber = (game.moveNumber || 0) + 1;
  const now = Date.now();

  const updates = {};
  updates[`rooms/${normalizedRoomCode}/game/fen`] = nextFen;
  updates[`rooms/${normalizedRoomCode}/game/turn`] = nextTurn;
  updates[`rooms/${normalizedRoomCode}/game/moveNumber`] = moveNumber;
  updates[`rooms/${normalizedRoomCode}/game/status`] = newGameStatus;
  updates[`rooms/${normalizedRoomCode}/game/winner`] = winner;
  updates[`rooms/${normalizedRoomCode}/game/lastMove`] = {
    from: moveResult.from,
    to: moveResult.to,
    san: moveResult.san,
    piece: moveResult.piece,
    promotion: moveResult.promotion || null,
  };

  if (newGameStatus !== "in_progress") {
    updates[`rooms/${normalizedRoomCode}/metadata/status`] = "finished";
  }

  const moveKey = db.ref(`rooms/${normalizedRoomCode}/moves`).push().key;
  updates[`rooms/${normalizedRoomCode}/moves/${moveKey}`] = {
    playerUid: uid,
    color: playerColor,
    from: moveResult.from,
    to: moveResult.to,
    san: moveResult.san,
    promotion: moveResult.promotion || null,
    fenAfter: nextFen,
    timestamp: now,
  };

  await db.ref().update(updates);

  return {
    success: true,
    fen: nextFen,
    turn: nextTurn,
    status: newGameStatus,
    winner,
    san: moveResult.san,
  };
});

/**
 * Periodic cleanup of expired rooms
 */
exports.cleanupExpiredRooms = functions.pubsub.schedule("every 2 hours").onRun(async (context) => {
  const now = Date.now();
  const roomsRef = db.ref("rooms");
  const snapshot = await roomsRef.orderByChild("metadata/expiresAt").endAt(now).get();

  if (!snapshot.exists()) return null;

  const updates = {};
  snapshot.forEach((child) => {
    updates[child.key] = null;
  });

  await roomsRef.update(updates);
  console.log(`Cleaned up expired rooms.`);
  return null;
});
