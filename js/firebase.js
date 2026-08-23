// ─────────────────────────────────────────────
//  LabChess — Firebase Module (Production-Ready)
//  Handles Firebase Anonymous Authentication,
//  App Check, Realtime Database sync, Atomic
//  Transactions, Presence, Timers & Draw Offers.
// ─────────────────────────────────────────────

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  onValue,
  off,
  runTransaction,
  serverTimestamp,
  onDisconnect,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import config from "../config.js";

// ── Firebase Core Singletons ──
let app = null;
let auth = null;
let db = null;
let currentUser = null;
let currentRoomCode = null;
let myPlayerColor = null;
let presenceDisconnectRef = null;

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// ─────────────────────────────────────────────
//  INITIALIZATION
// ─────────────────────────────────────────────

export async function initFirebase() {
  if (app) return { app, auth, db, user: currentUser };

  app = initializeApp(config.firebase);
  auth = getAuth(app);
  db = getDatabase(app);

  window._labchess_db = db;
  window._labchess_auth = auth;

  // Initialize App Check if enabled
  if (config.appCheck && config.appCheck.enabled && config.appCheck.siteKey) {
    try {
      const { initializeAppCheck, ReCaptchaV3Provider } = await import(
        "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js"
      );
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(config.appCheck.siteKey),
        isTokenAutoRefreshEnabled: config.appCheck.isTokenAutoRefreshEnabled ?? true,
      });
      console.log("[AppCheck] Initialized successfully");
    } catch (err) {
      console.warn("[AppCheck] Failed to initialize:", err);
    }
  }

  // Setup connection monitoring
  setupConnectionPresence();

  // Perform anonymous authentication (with fallback)
  currentUser = await new Promise((resolve) => {
    try {
      const unsubscribe = onAuthStateChanged(
        auth,
        (user) => {
          unsubscribe();
          if (user) {
            resolve(user);
          } else {
            signInAnonymously(auth)
              .then((cred) => resolve(cred.user))
              .catch((err) => {
                console.warn("[Auth] Using persistent fallback UID:", err.message);
                let fallbackUid = localStorage.getItem("labchess_fallback_uid");
                if (!fallbackUid) {
                  fallbackUid =
                    "anon_" +
                    Math.random().toString(36).slice(2, 11) +
                    "_" +
                    Date.now().toString(36);
                  localStorage.setItem("labchess_fallback_uid", fallbackUid);
                }
                resolve({ uid: fallbackUid, isAnonymous: true });
              });
          }
        },
        () => {
          let fallbackUid = localStorage.getItem("labchess_fallback_uid");
          if (!fallbackUid) {
            fallbackUid = "anon_" + Math.random().toString(36).slice(2, 11);
            localStorage.setItem("labchess_fallback_uid", fallbackUid);
          }
          resolve({ uid: fallbackUid, isAnonymous: true });
        }
      );
    } catch (e) {
      let fallbackUid = "anon_" + Math.random().toString(36).slice(2, 11);
      resolve({ uid: fallbackUid, isAnonymous: true });
    }
  });

  console.log(`[Auth] Player UID ready: ${currentUser.uid}`);
  return { app, auth, db, user: currentUser };
}

// ─────────────────────────────────────────────
//  CONNECTION PRESENCE (.info/connected)
// ─────────────────────────────────────────────

function setupConnectionPresence() {
  const connectedRef = ref(db, ".info/connected");
  onValue(connectedRef, (snap) => {
    const isConnected = snap.val() === true;
    window.dispatchEvent(
      new CustomEvent("labchess:connection-changed", {
        detail: { connected: isConnected },
      })
    );

    if (isConnected && currentRoomCode && myPlayerColor && currentUser) {
      updatePresence(true);
    }
  });
}

function updatePresence(online) {
  if (!currentRoomCode || !myPlayerColor || !currentUser) return;
  const playerRef = ref(db, `rooms/${currentRoomCode}/players/${myPlayerColor}`);
  update(playerRef, {
    connected: online,
    lastSeen: serverTimestamp(),
  }).catch(() => {});

  if (online) {
    presenceDisconnectRef = onDisconnect(playerRef);
    presenceDisconnectRef.update({
      connected: false,
      lastSeen: serverTimestamp(),
    });
  }
}

// ─────────────────────────────────────────────
//  ROOM CODE GENERATOR
// ─────────────────────────────────────────────

export function generateRoomCode() {
  let code = "";
  for (let i = 0; i < (config.limits?.roomCodeLength || 6); i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

// ─────────────────────────────────────────────
//  CREATE ROOM (With Optional Timer)
// ─────────────────────────────────────────────

export async function createRoom(chosenColor = "white", playerName = "Host", timeSeconds = 0) {
  await initFirebase();
  const uid = currentUser.uid;
  const sanitizedName = (playerName || "Host").trim().slice(0, 20);

  let attempts = 0;
  let roomCode = "";

  while (attempts < 5) {
    attempts++;
    roomCode = generateRoomCode();
    const roomRef = ref(db, `rooms/${roomCode}`);
    const existing = await get(roomRef);

    if (
      !existing.exists() ||
      (existing.val()?.metadata?.expiresAt &&
        Date.now() > existing.val().metadata.expiresAt)
    ) {
      const now = Date.now();
      const expiresAt = now + (config.limits?.roomTtlMinutes || 120) * 60 * 1000;
      const hostColor = chosenColor === "black" ? "black" : "white";
      const timeMs = timeSeconds > 0 ? timeSeconds * 1000 : 0;

      const newRoom = {
        metadata: {
          hostUid: uid,
          status: "waiting",
          createdAt: serverTimestamp(),
          expiresAt: expiresAt,
          rematchRequestedBy: null,
          drawOfferedBy: null,
          timeControl: timeSeconds, // 0 = unlimited
        },
        players: {
          [hostColor]: {
            uid: uid,
            name: sanitizedName,
            joinedAt: serverTimestamp(),
            connected: true,
            lastSeen: serverTimestamp(),
          },
        },
        game: {
          fen: START_FEN,
          turn: "w",
          moveNumber: 0,
          status: "in_progress",
          winner: null,
          lastMove: null,
          clocks:
            timeMs > 0
              ? {
                  whiteTimeMs: timeMs,
                  blackTimeMs: timeMs,
                  lastMoveTime: null,
                }
              : null,
        },
      };

      await set(roomRef, newRoom);

      currentRoomCode = roomCode;
      myPlayerColor = hostColor;
      updatePresence(true);
      saveSession(roomCode, hostColor, sanitizedName);

      console.log(`[Firebase] Room created: ${roomCode} | Color: ${hostColor} | Time: ${timeSeconds}s`);
      return { roomCode, color: hostColor };
    }
  }

  throw new Error("Unable to create unique room code. Please try again.");
}

// ─────────────────────────────────────────────
//  JOIN ROOM (Atomic Transaction)
// ─────────────────────────────────────────────

export async function joinRoom(rawCode, playerName = "Guest") {
  await initFirebase();
  const code = (rawCode || "").trim().toUpperCase();
  if (code.length !== 6) {
    throw new Error("Please enter a valid 6-character room code.");
  }

  const uid = currentUser.uid;
  const sanitizedName = (playerName || "Guest").trim().slice(0, 20);
  const roomRef = ref(db, `rooms/${code}`);

  const txResult = await runTransaction(roomRef, (currentData) => {
    if (!currentData) return currentData;

    const metadata = currentData.metadata || {};
    const players = currentData.players || {};

    if (players.white?.uid === uid || players.black?.uid === uid) {
      return currentData; // Reconnection
    }

    if (metadata.status !== "waiting") {
      return; // Not joinable
    }

    let joinColor = null;
    if (!players.white) joinColor = "white";
    else if (!players.black) joinColor = "black";
    else return;

    currentData.players = currentData.players || {};
    currentData.players[joinColor] = {
      uid: uid,
      name: sanitizedName,
      joinedAt: Date.now(),
      connected: true,
      lastSeen: Date.now(),
    };
    currentData.metadata.status = "active";

    // Initialize clock timer on game start
    if (currentData.game?.clocks) {
      currentData.game.clocks.lastMoveTime = Date.now();
    }

    return currentData;
  });

  if (!txResult.committed || !txResult.snapshot.exists()) {
    const snap = await get(roomRef);
    if (!snap.exists()) {
      throw new Error("Room not found. Check code and try again.");
    }
    const val = snap.val();
    if (
      val.metadata?.status === "active" &&
      val.players?.white?.uid !== uid &&
      val.players?.black?.uid !== uid
    ) {
      throw new Error("Room is already full with 2 players.");
    }
    if (val.metadata?.status === "finished") {
      throw new Error("This game has already concluded.");
    }
    throw new Error("Could not join room. Please try again.");
  }

  const roomData = txResult.snapshot.val();
  let assignedColor = "white";
  if (roomData.players?.white?.uid === uid) {
    assignedColor = "white";
  } else if (roomData.players?.black?.uid === uid) {
    assignedColor = "black";
  }

  currentRoomCode = code;
  myPlayerColor = assignedColor;
  updatePresence(true);
  saveSession(code, assignedColor, sanitizedName);

  console.log(`[Firebase] Joined room ${code} as ${assignedColor}`);
  return { roomCode: code, color: assignedColor, roomData };
}

// ─────────────────────────────────────────────
//  SUBMIT MOVE (With Clock Deduction)
// ─────────────────────────────────────────────

export async function submitMove(
  roomCode,
  { fen, turn, san, from, to, piece, promotion, isGameOver, winner, status, clocks }
) {
  const code = (roomCode || currentRoomCode).toUpperCase();
  const uid = currentUser?.uid;
  if (!uid) throw new Error("Unauthenticated");

  const movePayload = {
    playerUid: uid,
    from,
    to,
    san,
    piece: piece || null,
    promotion: promotion || null,
    timestamp: Date.now(),
    fenAfter: fen,
  };

  const updates = {};
  updates[`rooms/${code}/game/fen`] = fen;
  updates[`rooms/${code}/game/turn`] = turn;
  updates[`rooms/${code}/game/lastMove`] = {
    from,
    to,
    san,
    piece: piece || null,
    promotion: promotion || null,
  };
  updates[`rooms/${code}/game/status`] = isGameOver ? status : "in_progress";
  updates[`rooms/${code}/game/winner`] = isGameOver ? winner : null;

  if (clocks) {
    updates[`rooms/${code}/game/clocks`] = clocks;
  }

  if (isGameOver) {
    updates[`rooms/${code}/metadata/status`] = "finished";
    updates[`rooms/${code}/metadata/drawOfferedBy`] = null;
  }

  const newMoveKey = String(Date.now());
  updates[`rooms/${code}/moves/${newMoveKey}`] = movePayload;

  await update(ref(db), updates);
}

// ─────────────────────────────────────────────
//  DRAW WORKFLOW
// ─────────────────────────────────────────────

export async function offerDraw(roomCode) {
  const code = (roomCode || currentRoomCode).toUpperCase();
  const uid = currentUser?.uid;
  await update(ref(db, `rooms/${code}/metadata`), {
    drawOfferedBy: uid,
  });
}

export async function respondToDraw(roomCode, accept) {
  const code = (roomCode || currentRoomCode).toUpperCase();
  if (accept) {
    const updates = {};
    updates[`rooms/${code}/game/status`] = "draw";
    updates[`rooms/${code}/game/winner`] = "draw";
    updates[`rooms/${code}/metadata/status`] = "finished";
    updates[`rooms/${code}/metadata/drawOfferedBy`] = null;
    await update(ref(db), updates);
  } else {
    await update(ref(db, `rooms/${code}/metadata`), {
      drawOfferedBy: null,
    });
  }
}

// ─────────────────────────────────────────────
//  TIMEOUT CLAIM
// ─────────────────────────────────────────────

export async function claimTimeout(roomCode, winnerColor) {
  const code = (roomCode || currentRoomCode).toUpperCase();
  const updates = {};
  updates[`rooms/${code}/game/status`] = "timeout";
  updates[`rooms/${code}/game/winner`] = winnerColor === "white" ? "w" : "b";
  updates[`rooms/${code}/metadata/status`] = "finished";
  await update(ref(db), updates);
}

// ─────────────────────────────────────────────
//  RESIGN GAME
// ─────────────────────────────────────────────

export async function resignGame(roomCode, myColor) {
  const code = (roomCode || currentRoomCode).toUpperCase();
  const winner = myColor === "white" ? "b" : "w";

  const updates = {};
  updates[`rooms/${code}/game/status`] = "resigned";
  updates[`rooms/${code}/game/winner`] = winner;
  updates[`rooms/${code}/metadata/status`] = "finished";
  updates[`rooms/${code}/metadata/drawOfferedBy`] = null;

  await update(ref(db), updates);
}

// ─────────────────────────────────────────────
//  REMATCH WORKFLOW (Two-Player Agreement)
// ─────────────────────────────────────────────

export async function requestOrAcceptRematch(roomCode, myColor) {
  const code = (roomCode || currentRoomCode).toUpperCase();
  const uid = currentUser?.uid;
  const roomRef = ref(db, `rooms/${code}`);

  const result = await runTransaction(roomRef, (room) => {
    if (!room) return room;
    const metadata = room.metadata || {};
    const players = room.players || {};

    if (!metadata.rematchRequestedBy) {
      metadata.rematchRequestedBy = uid;
      room.metadata = metadata;
      return room;
    }

    if (metadata.rematchRequestedBy !== uid) {
      const oldWhite = players.white;
      const oldBlack = players.black;
      const timeMs = metadata.timeControl > 0 ? metadata.timeControl * 1000 : 0;

      room.players = {
        white: oldBlack ? { ...oldBlack } : null,
        black: oldWhite ? { ...oldWhite } : null,
      };

      room.game = {
        fen: START_FEN,
        turn: "w",
        moveNumber: 0,
        status: "in_progress",
        winner: null,
        lastMove: null,
        clocks:
          timeMs > 0
            ? {
                whiteTimeMs: timeMs,
                blackTimeMs: timeMs,
                lastMoveTime: Date.now(),
              }
            : null,
      };

      room.moves = null;
      metadata.status = "active";
      metadata.rematchRequestedBy = null;
      metadata.drawOfferedBy = null;
      room.metadata = metadata;
      return room;
    }

    return room;
  });

  return result.snapshot.val();
}

// ─────────────────────────────────────────────
//  REALTIME ROOM LISTENER
// ─────────────────────────────────────────────

export function listenToRoom(roomCode, callback) {
  const code = roomCode.toUpperCase();
  const roomR = ref(db, `rooms/${code}`);

  const handler = (snap) => {
    if (!snap.exists()) {
      callback(null);
      return;
    }
    callback(snap.val());
  };

  onValue(roomR, handler);

  return () => {
    off(roomR, "value", handler);
  };
}

// ─────────────────────────────────────────────
//  SPECTATOR MANAGEMENT
// ─────────────────────────────────────────────

export async function joinAsSpectator(roomCode, spectatorName = "Spectator") {
  await initFirebase();
  const code = roomCode.toUpperCase();
  const uid = currentUser?.uid;
  if (!uid) return;

  const specRef = ref(db, `rooms/${code}/spectators/${uid}`);
  await set(specRef, {
    name: (spectatorName || "Spectator").trim().slice(0, 20),
    joinedAt: Date.now(),
  });

  const discRef = onDisconnect(specRef);
  discRef.remove();

  currentRoomCode = code;
  myPlayerColor = "spectator";
}

export function listenToSpectators(roomCode, callback) {
  const code = roomCode.toUpperCase();
  const specsRef = ref(db, `rooms/${code}/spectators`);

  const handler = (snap) => {
    const val = snap.val() || {};
    const count = Object.keys(val).length;
    callback(count, val);
  };

  onValue(specsRef, handler);
  return () => off(specsRef, "value", handler);
}

// ─────────────────────────────────────────────
//  CHAT & FLOATING REACTIONS
// ─────────────────────────────────────────────

export async function sendChatMessage(roomCode, text, senderName = "Player") {
  const code = (roomCode || currentRoomCode).toUpperCase();
  const uid = currentUser?.uid;
  if (!uid || !text.trim()) return;

  const msgId = String(Date.now()) + "_" + Math.random().toString(36).slice(2, 6);
  const msgRef = ref(db, `rooms/${code}/chat/${msgId}`);
  await set(msgRef, {
    senderUid: uid,
    sender: (senderName || "Player").trim().slice(0, 20),
    text: text.trim().slice(0, 160),
    timestamp: Date.now(),
  });
}

export function listenToChat(roomCode, callback) {
  const code = roomCode.toUpperCase();
  const chatRef = ref(db, `rooms/${code}/chat`);

  const handler = (snap) => {
    const val = snap.val() || {};
    const messages = Object.values(val).sort((a, b) => a.timestamp - b.timestamp);
    callback(messages);
  };

  onValue(chatRef, handler);
  return () => off(chatRef, "value", handler);
}

export async function sendReaction(roomCode, emoji) {
  const code = (roomCode || currentRoomCode).toUpperCase();
  const uid = currentUser?.uid;
  if (!uid || !emoji) return;

  const rxId = String(Date.now()) + "_" + Math.random().toString(36).slice(2, 6);
  const rxRef = ref(db, `rooms/${code}/reactions/${rxId}`);
  await set(rxRef, {
    senderUid: uid,
    emoji,
    timestamp: Date.now(),
  });
}

export function listenToReactions(roomCode, callback) {
  const code = roomCode.toUpperCase();
  const rxRef = ref(db, `rooms/${code}/reactions`);

  const handler = (snap) => {
    const val = snap.val();
    if (!val) return;
    const items = Object.values(val);
    const latest = items.sort((a, b) => b.timestamp - a.timestamp)[0];
    if (latest && Date.now() - latest.timestamp < 3500) {
      callback(latest);
    }
  };

  onValue(rxRef, handler);
  return () => off(rxRef, "value", handler);
}

// ─────────────────────────────────────────────
//  SESSION PERSISTENCE
// ─────────────────────────────────────────────

const SESSION_KEY = "labchess_active_session";

export function saveSession(roomCode, color, name) {
  try {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        roomCode,
        color,
        name,
        timestamp: Date.now(),
      })
    );
  } catch (e) {}
}

export function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    if (presenceDisconnectRef) {
      presenceDisconnectRef.cancel();
      presenceDisconnectRef = null;
    }
    if (currentRoomCode && myPlayerColor) {
      updatePresence(false);
    }
    currentRoomCode = null;
    myPlayerColor = null;
  } catch (e) {}
}

export async function checkExistingSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session.roomCode) return null;

    await initFirebase();
    const uid = currentUser?.uid;
    const snap = await get(ref(db, `rooms/${session.roomCode}`));

    if (!snap.exists()) {
      clearSession();
      return null;
    }

    const room = snap.val();
    const players = room.players || {};

    let confirmedColor = null;
    if (players.white?.uid === uid) confirmedColor = "white";
    else if (players.black?.uid === uid) confirmedColor = "black";

    if (!confirmedColor) {
      clearSession();
      return null;
    }

    currentRoomCode = session.roomCode;
    myPlayerColor = confirmedColor;
    updatePresence(true);

    return {
      roomCode: session.roomCode,
      color: confirmedColor,
      roomData: room,
      name: session.name,
    };
  } catch (e) {
    console.warn("[Session] Restoration check failed:", e);
    return null;
  }
}

export function getCurrentUser() {
  return currentUser;
}
export function getCurrentRoomCode() {
  return currentRoomCode;
}
export function getMyPlayerColor() {
  return myPlayerColor;
}