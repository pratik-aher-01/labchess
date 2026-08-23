// ─────────────────────────────────────────────
//  LabChess — UI Module (Production-Ready)
//  Handles screen transitions, user interactions,
//  AI practice, clocks, spectators, chat, floating
//  reactions, replay navigation, and modals.
// ─────────────────────────────────────────────

import {
  createRoom,
  joinRoom,
  listenToRoom,
  checkExistingSession,
  clearSession,
  getMyPlayerColor,
  getCurrentUser,
  sendChatMessage,
  listenToChat,
  sendReaction,
  listenToReactions,
} from "./firebase.js";
import {
  initGame,
  initAiGame,
  initSpectatorGame,
  leaveGame,
  resign,
  offerDraw,
  handleDrawResponse,
  requestRematch,
  getPGN,
  getFEN,
  goToHistoryIndex,
  stepFirstMove,
  stepPrevMove,
  stepNextMove,
  stepLiveMove,
  isViewingHistory,
  getMoveHistory,
} from "./game.js";
import { initBoard, hideOverlay, flipBoardOrientation } from "./board.js";
import { toggleSound, isSoundEnabled } from "./audio.js";
import { stopConfetti } from "./confetti.js";

let selectedColor = "white";
let selectedTimeSeconds = 0; // 0 = unlimited
let selectedAiDifficulty = "medium";
let selectedAiColor = "white";
let selectedAiTime = 0;

let toastTimeout = null;
let chatUnsubscribe = null;
let reactionsUnsubscribe = null;
let isChatOpen = false;
let lastSeenChatCount = 0;

// ─────────────────────────────────────────────
//  INITIALIZATION ON PAGE LOAD
// ─────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();
  loadStoredPlayerName();
  checkUrlForRoomCode();

  // Listen for connection state changes
  window.addEventListener("labchess:connection-changed", (e) => {
    updateConnectionBadge(e.detail?.connected ?? true);
  });

  // Check for active session to resume (page refresh recovery)
  try {
    const existing = await checkExistingSession();
    if (existing && existing.roomCode && existing.color) {
      console.log(`[Session] Resuming active game: ${existing.roomCode}`);
      showToast("Resuming your active game session...", "success", 2500);
      startGame(
        existing.roomCode,
        existing.color,
        existing.roomData?.game?.fen,
        existing.roomData
      );
    }
  } catch (err) {
    console.warn("[Session] Could not restore session:", err);
  }
});

// ─────────────────────────────────────────────
//  SCREEN TRANSITIONS
// ─────────────────────────────────────────────

export function showScreen(id) {
  stopConfetti();

  // Hide all modals when switching screens
  document.querySelectorAll(".fullscreen-modal-backdrop").forEach((m) => {
    m.classList.add("hidden");
  });

  // Clean URL query params if returning to lobby
  if (id === "lobby-screen" && window.location.search) {
    window.history.replaceState({}, document.title, window.location.pathname);
    const joinInput = document.getElementById("join-code-input");
    if (joinInput) joinInput.value = "";
  }

  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  const target = document.getElementById(id);
  if (target) {
    target.classList.add("active");
    window.scrollTo(0, 0);
  }
}

// ─────────────────────────────────────────────
//  TOAST NOTIFICATIONS
// ─────────────────────────────────────────────

export function showToast(message, type = "default", duration = 3200) {
  const toast = document.getElementById("toast");
  if (!toast) return;

  toast.textContent = message;
  toast.className = `toast ${type}`;

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.add("hidden");
  }, duration);
}

// ─────────────────────────────────────────────
//  CUSTOM IN-APP CONFIRMATION MODAL
// ─────────────────────────────────────────────

export function showConfirmModal({
  emoji = "⚠️",
  title = "Are you sure?",
  desc = "This action cannot be undone.",
  okText = "Confirm",
  cancelText = "Cancel",
  isDanger = false,
} = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirm-modal");
    const emojiEl = document.getElementById("confirm-emoji");
    const titleEl = document.getElementById("confirm-title");
    const descEl = document.getElementById("confirm-desc");
    const btnOk = document.getElementById("btn-confirm-ok");
    const btnCancel = document.getElementById("btn-confirm-cancel");

    if (!modal || !btnOk || !btnCancel) {
      resolve(true);
      return;
    }

    if (emojiEl) emojiEl.textContent = emoji;
    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = desc;

    btnOk.textContent = okText;
    btnCancel.textContent = cancelText;

    if (isDanger) {
      btnOk.className = "btn-danger";
    } else {
      btnOk.className = "btn-primary";
    }

    modal.classList.remove("hidden");

    const cleanup = () => {
      modal.classList.add("hidden");
      btnOk.removeEventListener("click", onOk);
      btnCancel.removeEventListener("click", onCancel);
    };

    const onOk = () => {
      cleanup();
      resolve(true);
    };

    const onCancel = () => {
      cleanup();
      resolve(false);
    };

    btnOk.addEventListener("click", onOk);
    btnCancel.addEventListener("click", onCancel);
  });
}

// ─────────────────────────────────────────────
//  CONNECTION BADGE
// ─────────────────────────────────────────────

function updateConnectionBadge(online) {
  const badge = document.getElementById("connection-badge");
  const text = document.getElementById("conn-text");
  if (!badge || !text) return;

  if (online) {
    badge.className = "connection-badge connected";
    text.textContent = "Connected";
  } else {
    badge.className = "connection-badge disconnected";
    text.textContent = "Reconnecting...";
  }
}

// ─────────────────────────────────────────────
//  EVENT LISTENERS SETUP
// ─────────────────────────────────────────────

function setupEventListeners() {
  // Lobby Tabs (Create, Join, AI)
  const tabCreate = document.getElementById("tab-create");
  const tabJoin = document.getElementById("tab-join");
  const tabAi = document.getElementById("tab-ai");

  const activateTab = (tabEl, mode) => {
    [tabCreate, tabJoin, tabAi].forEach((t) => {
      t?.classList.remove("active");
      t?.setAttribute("aria-selected", "false");
    });
    tabEl?.classList.add("active");
    tabEl?.setAttribute("aria-selected", "true");

    const dualCard = document.getElementById("lobby-dual-card");
    const aiCard = document.getElementById("lobby-ai-card");

    if (mode === "ai") {
      dualCard?.classList.add("hidden");
      aiCard?.classList.remove("hidden");
    } else {
      aiCard?.classList.add("hidden");
      dualCard?.classList.remove("hidden", "show-create", "show-join");
      dualCard?.classList.add(mode === "join" ? "show-join" : "show-create");
      if (mode === "join") {
        document.getElementById("join-code-input")?.focus();
      }
    }
  };

  tabCreate?.addEventListener("click", () => activateTab(tabCreate, "create"));
  tabJoin?.addEventListener("click", () => activateTab(tabJoin, "join"));
  tabAi?.addEventListener("click", () => activateTab(tabAi, "ai"));

  // Match Color selection (Human vs Human)
  document.querySelectorAll("#panel-create .color-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#panel-create .color-btn").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-checked", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-checked", "true");
      selectedColor = btn.dataset.color || "white";
    });
  });

  // Time control selection (Human vs Human)
  document.querySelectorAll("#panel-create .time-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#panel-create .time-btn").forEach((b) => {
        b.classList.remove("active");
      });
      btn.classList.add("active");
      selectedTimeSeconds = parseInt(btn.dataset.time || "0", 10);
    });
  });

  // AI Difficulty selection
  document.querySelectorAll(".diff-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".diff-btn").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-checked", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-checked", "true");
      selectedAiDifficulty = btn.dataset.diff || "medium";
    });
  });

  // AI Color selection
  document.querySelectorAll(".ai-color-pick .color-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".ai-color-pick .color-btn").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-checked", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-checked", "true");
      selectedAiColor = btn.dataset.color || "white";
    });
  });

  // AI Time control selection
  document.querySelectorAll(".ai-time-pick .time-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".ai-time-pick .time-btn").forEach((b) => {
        b.classList.remove("active");
      });
      btn.classList.add("active");
      selectedAiTime = parseInt(btn.dataset.time || "0", 10);
    });
  });

  // Start AI Match Button
  document.getElementById("btn-start-ai")?.addEventListener("click", () => {
    showScreen("game-screen");
    document.getElementById("header-room-code").textContent = "BOT";
    initBoard("start");
    initAiGame(selectedAiColor, selectedAiDifficulty, selectedAiTime);
    showToast(`Started match against ${selectedAiDifficulty.toUpperCase()} Bot!`, "success");
  });

  // Player Name input
  const nameInput = document.getElementById("player-name-input");
  nameInput?.addEventListener("change", () => {
    const val = nameInput.value.trim();
    if (val) localStorage.setItem("labchess_player_name", val);
  });

  // Sound toggle button
  document.getElementById("btn-sound-toggle")?.addEventListener("click", () => {
    const enabled = toggleSound();
    const btn = document.getElementById("btn-sound-toggle");
    if (btn) btn.textContent = enabled ? "🔊" : "🔇";
    showToast(enabled ? "Sound enabled" : "Sound muted", "default", 1500);
  });

  // Lobby Action buttons
  document.getElementById("btn-create")?.addEventListener("click", handleCreateRoom);
  document.getElementById("btn-join")?.addEventListener("click", handleJoinRoom);
  const joinInput = document.getElementById("join-code-input");
  joinInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleJoinRoom();
  });
  joinInput?.addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });

  // Copy Code in Waiting Screen & Share Header
  document.getElementById("btn-copy-code")?.addEventListener("click", copyRoomCode);
  document.getElementById("btn-copy-link")?.addEventListener("click", copyRoomLink);
  document.getElementById("btn-header-share")?.addEventListener("click", copyRoomLink);

  // PGN & FEN Copy buttons (Desktop sidebar)
  document.getElementById("btn-copy-pgn")?.addEventListener("click", () => {
    const pgn = getPGN();
    navigator.clipboard.writeText(pgn).then(() => {
      showToast("Game PGN copied to clipboard!", "success");
    }).catch(() => showToast("Could not copy PGN.", "error"));
  });

  document.getElementById("btn-copy-fen")?.addEventListener("click", () => {
    const fen = getFEN();
    navigator.clipboard.writeText(fen).then(() => {
      showToast("Current FEN copied to clipboard!", "success");
    }).catch(() => showToast("Could not copy FEN.", "error"));
  });

  // Move History Modal (Mobile & Popout)
  const movesModal = document.getElementById("moves-modal");
  const openMovesModal = () => movesModal?.classList.remove("hidden");
  const closeMovesModal = () => movesModal?.classList.add("hidden");

  document.getElementById("btn-moves-toggle")?.addEventListener("click", openMovesModal);
  document.getElementById("btn-header-moves")?.addEventListener("click", openMovesModal);
  document.getElementById("last-move-pill")?.addEventListener("click", openMovesModal);
  document.getElementById("status-move-pill")?.addEventListener("click", openMovesModal);
  document.getElementById("btn-close-moves")?.addEventListener("click", closeMovesModal);

  movesModal?.addEventListener("click", (e) => {
    if (e.target === movesModal) closeMovesModal();
  });

  // Modal PGN & FEN Copy buttons
  document.getElementById("btn-modal-copy-pgn")?.addEventListener("click", () => {
    const pgn = getPGN();
    navigator.clipboard.writeText(pgn).then(() => {
      showToast("Game PGN copied to clipboard!", "success");
    }).catch(() => showToast("Could not copy PGN.", "error"));
  });

  document.getElementById("btn-modal-copy-fen")?.addEventListener("click", () => {
    const fen = getFEN();
    navigator.clipboard.writeText(fen).then(() => {
      showToast("Current FEN copied to clipboard!", "success");
    }).catch(() => showToast("Could not copy FEN.", "error"));
  });

  // Replay Navigation Controls
  document.getElementById("btn-replay-first")?.addEventListener("click", stepFirstMove);
  document.getElementById("btn-replay-prev")?.addEventListener("click", stepPrevMove);
  document.getElementById("btn-replay-next")?.addEventListener("click", stepNextMove);
  document.getElementById("btn-replay-live")?.addEventListener("click", stepLiveMove);
  document.getElementById("btn-flip-board")?.addEventListener("click", () => {
    const orientation = flipBoardOrientation();
    showToast(`Flipped board to ${orientation.toUpperCase()} perspective`, "default", 1500);
  });

  // Quick Emoji Reactions (Thought Cloud Bubble on Opponent Bar)
  document.querySelectorAll(".reaction-bar .btn-reaction").forEach((btn) => {
    btn.addEventListener("click", () => {
      const emoji = btn.dataset.emoji;
      if (!emoji) return;
      const roomCode = document.getElementById("header-room-code")?.textContent;
      if (roomCode && roomCode !== "——" && roomCode !== "BOT") {
        sendReaction(roomCode, emoji);
      } else {
        // Local AI practice match: bot replies with an emoji thought bubble above bot!
        const botReactions = ["🔥", "👏", "👑", "😮", "🤝", "😅"];
        const botReaction = botReactions[Math.floor(Math.random() * botReactions.length)];
        setTimeout(() => {
          showPlayerBubble("opponent", botReaction, "emoji");
        }, 800);
      }
    });
  });

  // Chat Drawer Toggle & Message Submission
  const chatDrawer = document.getElementById("chat-drawer");
  const chatToggle = document.getElementById("btn-chat-toggle");
  const chatClose = document.getElementById("btn-close-chat");
  const chatInput = document.getElementById("chat-input");
  const btnSendChat = document.getElementById("btn-send-chat");

  chatToggle?.addEventListener("click", () => {
    isChatOpen = !isChatOpen;
    chatDrawer?.classList.toggle("hidden", !isChatOpen);
    if (isChatOpen) {
      document.getElementById("chat-unread-dot")?.classList.add("hidden");
      chatInput?.focus();
    }
  });

  chatClose?.addEventListener("click", () => {
    isChatOpen = false;
    chatDrawer?.classList.add("hidden");
  });

  const submitChat = () => {
    const text = chatInput?.value?.trim();
    if (!text) return;
    const roomCode = document.getElementById("header-room-code")?.textContent;
    const name = getPlayerName();
    if (roomCode && roomCode !== "——" && roomCode !== "BOT") {
      sendChatMessage(roomCode, text, name);
    } else {
      // Local AI / offline echo
      appendChatMessage({ sender: name, text, timestamp: Date.now() });

      // Local AI practice match: bot responds with speech bubble above opponent!
      const aiReplies = [
        "Good luck! ♟️",
        "Interesting move! Let's see what happens.",
        "May the best mind win! ⚔️",
        "I'm calculating the best moves... 🤔",
        "Nice game so far! 👑",
      ];
      const reply = aiReplies[Math.floor(Math.random() * aiReplies.length)];
      setTimeout(() => {
        const aiName = document.getElementById("name-opponent")?.textContent || "StockBot";
        appendChatMessage({ sender: aiName, text: reply, timestamp: Date.now() });
        showPlayerBubble("opponent", reply, "chat", aiName);
      }, 900);
    }
    if (chatInput) chatInput.value = "";
  };

  btnSendChat?.addEventListener("click", (e) => {
    e.preventDefault();
    submitChat();
  });

  chatInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitChat();
    }
  });

  // Draw Offer Confirmation
  document.getElementById("btn-draw")?.addEventListener("click", async () => {
    const ok = await showConfirmModal({
      emoji: "🤝",
      title: "Offer a Draw?",
      desc: "Send a proposal to your opponent to finish this game as a draw.",
      okText: "Send Offer",
      cancelText: "Cancel",
      isDanger: false,
    });
    if (ok) offerDraw();
  });

  document.getElementById("btn-accept-draw")?.addEventListener("click", () => {
    handleDrawResponse(true);
  });

  document.getElementById("btn-decline-draw")?.addEventListener("click", () => {
    handleDrawResponse(false);
  });

  // Cancel waiting
  document.getElementById("btn-cancel-waiting")?.addEventListener("click", () => {
    leaveGame();
    clearSession();
    showScreen("lobby-screen");
  });

  // Resign Confirmation
  document.getElementById("btn-resign")?.addEventListener("click", async () => {
    const ok = await showConfirmModal({
      emoji: "🏳️",
      title: "Resign Game?",
      desc: "This will immediately forfeit the game and award victory to your opponent.",
      okText: "Resign Game",
      cancelText: "Keep Playing",
      isDanger: true,
    });
    if (ok) resign();
  });

  // Exit Confirmation
  document.getElementById("btn-leave")?.addEventListener("click", async () => {
    const ok = await showConfirmModal({
      emoji: "🚪",
      title: "Leave Game?",
      desc: "Return to the lobby and leave the active match.",
      okText: "Leave Game",
      cancelText: "Stay",
      isDanger: true,
    });
    if (ok) {
      leaveGame();
      clearSession();
      showScreen("lobby-screen");
    }
  });

  // Rematch & Return to Lobby from Overlay
  document.getElementById("btn-rematch")?.addEventListener("click", () => {
    requestRematch();
  });

  document.getElementById("btn-overlay-lobby")?.addEventListener("click", () => {
    leaveGame();
    clearSession();
    showScreen("lobby-screen");
  });
}

// ─────────────────────────────────────────────
//  HANDLE ROOM CREATION & JOINING
// ─────────────────────────────────────────────

async function handleCreateRoom() {
  const btn = document.getElementById("btn-create");
  const name = getPlayerName();
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Creating Room...";
  }

  try {
    const { roomCode, color } = await createRoom(selectedColor, name, selectedTimeSeconds);

    document.getElementById("display-room-code").textContent = roomCode;
    document.getElementById("header-room-code").textContent = roomCode;
    showScreen("waiting-screen");

    let unsub = null;
    unsub = listenToRoom(roomCode, (roomData) => {
      if (!roomData) return;
      if (roomData.metadata?.status === "active") {
        if (unsub) unsub();
        startGame(roomCode, color, roomData.game?.fen, roomData);
      }
    });
  } catch (err) {
    console.error("[UI] Room creation failed:", err);
    showToast(err.message || "Failed to create room.", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Create Room";
    }
  }
}

async function handleJoinRoom() {
  const input = document.getElementById("join-code-input");
  const btn = document.getElementById("btn-join");
  const code = input?.value.trim().toUpperCase();
  const name = getPlayerName();

  if (!code || code.length !== 6) {
    showToast("Please enter a valid 6-character room code.", "error");
    input?.focus();
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Joining Room...";
  }

  try {
    const { roomCode, color, roomData } = await joinRoom(code, name);
    document.getElementById("header-room-code").textContent = roomCode;
    startGame(roomCode, color, roomData?.game?.fen, roomData);
  } catch (err) {
    console.warn("[UI] Standard join failed:", err.message);
    if (err.message.includes("full")) {
      // Offer spectator mode
      const ok = await showConfirmModal({
        emoji: "👁️",
        title: "Room is Full",
        desc: "This room already has 2 active players. Would you like to watch as a Spectator?",
        okText: "Spectate Match",
        cancelText: "Cancel",
      });
      if (ok) {
        showScreen("game-screen");
        document.getElementById("header-room-code").textContent = code;
        initBoard("start");
        initSpectatorGame(code, name);
        setupRoomChannels(code);
        showToast(`Spectating Room ${code}`, "success");
      }
    } else {
      showToast(err.message || "Could not join room.", "error");
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Join Room";
    }
  }
}

// ─────────────────────────────────────────────
//  START GAME (SCREEN TRANSITION)
// ─────────────────────────────────────────────

function startGame(roomCode, myColor, fen, roomData) {
  showScreen("game-screen");
  document.getElementById("header-room-code").textContent = roomCode;

  initBoard(fen || "start");
  initGame(roomCode, myColor, fen, roomData);
  setupRoomChannels(roomCode);

  showToast(`Joined game as ${myColor.toUpperCase()}`, "success", 3000);
}

let lastChatLength = 0;
let initialChatLoaded = false;

function setupRoomChannels(roomCode) {
  if (chatUnsubscribe) chatUnsubscribe();
  if (reactionsUnsubscribe) reactionsUnsubscribe();

  lastChatLength = 0;
  initialChatLoaded = false;

  chatUnsubscribe = listenToChat(roomCode, (messages) => {
    renderChatMessages(messages);
  });

  reactionsUnsubscribe = listenToReactions(roomCode, (reaction) => {
    if (!reaction || !reaction.emoji) return;
    const currentUser = getCurrentUser();
    const myUid = currentUser?.uid;
    const isMe = reaction.senderUid && myUid && reaction.senderUid === myUid;
    if (!isMe) {
      showPlayerBubble("opponent", reaction.emoji, "emoji");
      showToast(`Reaction from opponent: ${reaction.emoji}`, "default", 2500);
    }
  });
}

// ─────────────────────────────────────────────
//  COPY HELPERS
// ─────────────────────────────────────────────

function copyRoomCode() {
  const code = document.getElementById("display-room-code")?.textContent;
  if (!code || code === "——————") return;

  navigator.clipboard
    .writeText(code)
    .then(() => {
      const btn = document.getElementById("btn-copy-code");
      if (btn) {
        btn.textContent = "Copied!";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = "Copy Code";
          btn.classList.remove("copied");
        }, 2000);
      }
    })
    .catch(() => showToast("Could not copy code automatically.", "error"));
}

function copyRoomLink() {
  const code =
    document.getElementById("display-room-code")?.textContent ||
    document.getElementById("header-room-code")?.textContent;

  if (!code || code === "——————" || code === "——" || code === "BOT") return;

  const isGameActive = document.getElementById("game-screen")?.classList.contains("active");
  const spectateParam = isGameActive ? "&spectate=true" : "";
  const url = `${window.location.origin}${window.location.pathname}?room=${code}${spectateParam}`;
  navigator.clipboard
    .writeText(url)
    .then(() => {
      showToast(isGameActive ? "Live Spectator link copied to clipboard!" : "Invitation link copied to clipboard!", "success");
    })
    .catch(() => {
      showToast("Could not copy link automatically.", "error");
    });
}

function checkUrlForRoomCode() {
  try {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get("room");
    const isSpectate = params.get("spectate") === "true";

    if (roomParam && roomParam.length === 6) {
      const name = getPlayerName();
      if (isSpectate) {
        showScreen("game-screen");
        document.getElementById("header-room-code").textContent = roomParam.toUpperCase();
        initBoard("start");
        initSpectatorGame(roomParam.toUpperCase(), name);
        setupRoomChannels(roomParam.toUpperCase());
        showToast(`Watching Room ${roomParam.toUpperCase()} as Spectator`, "success");
      } else {
        const input = document.getElementById("join-code-input");
        if (input) {
          input.value = roomParam.toUpperCase();
          showToast(`Room code ${roomParam.toUpperCase()} detected in URL.`, "default");
          document.getElementById("tab-join")?.click();
        }
      }
    }
  } catch (e) {}
}

function loadStoredPlayerName() {
  try {
    const stored = localStorage.getItem("labchess_player_name");
    if (stored) {
      const input = document.getElementById("player-name-input");
      if (input) input.value = stored;
    }
  } catch (e) {}
}

function getPlayerName() {
  const input = document.getElementById("player-name-input");
  return input?.value.trim() || "Anonymous";
}

// ─────────────────────────────────────────────
//  UI UPDATERS
// ─────────────────────────────────────────────

export function updateStatusBar(chess, isMyTurn, myColor, opts = {}) {
  const turnText = document.getElementById("turn-text");
  const turnDot = document.getElementById("turn-dot");
  const moveCount = document.getElementById("move-count");
  if (!chess) return;

  const moves = (typeof getMoveHistory === "function" && getMoveHistory().length > 0) ? getMoveHistory() : chess.history();
  if (moveCount) moveCount.textContent = moves.length;

  if (opts.gameOver) {
    if (turnText) turnText.textContent = "Finished";
    if (turnDot) turnDot.className = "turn-dot";
    return;
  }

  const currentTurn = chess.turn();
  const isWhiteTurn = currentTurn === "w";
  const myColorChar = myColor === "white" ? "w" : "b";
  const isTurnForMe = currentTurn === myColorChar;

  if (turnText) {
    if (myColor === "spectator") {
      turnText.textContent = isWhiteTurn ? "White's Turn" : "Black's Turn";
    } else if (chess.in_checkmate()) {
      turnText.textContent = "Checkmate!";
    } else if (chess.in_draw() || chess.in_stalemate()) {
      turnText.textContent = "Draw";
    } else if (chess.in_check()) {
      turnText.textContent = isTurnForMe ? "Check!" : "Opponent Check!";
    } else {
      turnText.textContent = isTurnForMe ? "Your Turn" : "Opponent Turn";
    }
  }

  if (turnDot) {
    turnDot.className = `turn-dot ${
      isWhiteTurn ? "white" : "black"
    } ${isTurnForMe ? "my-turn" : ""}`;
  }
}

export function updateMoveHistory(moves = []) {
  const tbody = document.getElementById("move-table-body");
  const modalTbody = document.getElementById("modal-move-table-body");
  const badge = document.getElementById("moves-badge");
  const lastMovePill = document.getElementById("last-move-pill");

  if (badge) badge.textContent = moves.length;

  if (lastMovePill) {
    if (moves.length > 0) {
      const lastSan = moves[moves.length - 1];
      const moveNum = Math.ceil(moves.length / 2);
      const isWhite = moves.length % 2 !== 0;
      lastMovePill.textContent = `📜 ${moveNum}.${isWhite ? "" : ".."} ${lastSan}`;
    } else {
      lastMovePill.textContent = "No moves";
    }
  }

  const renderRows = (targetTbody) => {
    if (!targetTbody) return;
    targetTbody.innerHTML = "";

    for (let i = 0; i < moves.length; i += 2) {
      const moveNum = Math.floor(i / 2) + 1;
      const whiteMove = moves[i] || "";
      const blackMove = moves[i + 1] || "";

      const tr = document.createElement("tr");

      const tdNum = document.createElement("td");
      tdNum.className = "move-num";
      tdNum.textContent = `${moveNum}.`;

      const tdWhite = document.createElement("td");
      tdWhite.className = "move-san";
      tdWhite.textContent = whiteMove;
      tdWhite.dataset.moveIdx = String(i + 1);
      tdWhite.addEventListener("click", () => goToHistoryIndex(i + 1));

      const tdBlack = document.createElement("td");
      tdBlack.className = "move-san";
      tdBlack.textContent = blackMove;
      if (blackMove) {
        tdBlack.dataset.moveIdx = String(i + 2);
        tdBlack.addEventListener("click", () => goToHistoryIndex(i + 2));
      }

      tr.appendChild(tdNum);
      tr.appendChild(tdWhite);
      tr.appendChild(tdBlack);
      targetTbody.appendChild(tr);
    }
  };

  renderRows(tbody);
  renderRows(modalTbody);

  const container = document.querySelector(".move-table-container");
  if (container) container.scrollTop = container.scrollHeight;
  const modalContainer = document.querySelector(".modal-move-container");
  if (modalContainer) modalContainer.scrollTop = modalContainer.scrollHeight;
}

export function updatePlayerBars(myColor, players = {}, chess = null) {
  const opponentColor = myColor === "white" ? "black" : "white";
  const meData = players[myColor] || {};
  const opponentData = players[opponentColor] || {};

  const nameMe = document.getElementById("name-me");
  const nameOpponent = document.getElementById("name-opponent");
  if (nameMe) nameMe.textContent = myColor === "spectator" ? (players.white?.name || "White") : (meData.name || "You");
  if (nameOpponent) nameOpponent.textContent = myColor === "spectator" ? (players.black?.name || "Black") : (opponentData.name || "Opponent");

  const avatarMe = document.getElementById("avatar-me");
  const avatarOpponent = document.getElementById("avatar-opponent");
  if (avatarMe) avatarMe.textContent = myColor === "black" ? "♚" : "♔";
  if (avatarOpponent) avatarOpponent.textContent = myColor === "black" ? "♔" : "♚";

  // Captured pieces & Material difference calculation
  if (chess) {
    const { mine, theirs, myAdvantage, opponentAdvantage } = getCapturedPieces(
      chess,
      myColor === "spectator" ? "white" : myColor
    );
    const capturedMe = document.getElementById("captured-me");
    const capturedOpponent = document.getElementById("captured-opponent");
    if (capturedMe) capturedMe.textContent = mine;
    if (capturedOpponent) capturedOpponent.textContent = theirs;

    const matMe = document.getElementById("material-me");
    const matOpponent = document.getElementById("material-opponent");
    if (matMe) {
      matMe.textContent = `+${myAdvantage}`;
      matMe.classList.toggle("hidden", myAdvantage <= 0);
    }
    if (matOpponent) {
      matOpponent.textContent = `+${opponentAdvantage}`;
      matOpponent.classList.toggle("hidden", opponentAdvantage <= 0);
    }
  }
}

export function updatePresenceIndicators(myColor, players = {}) {
  const opponentColor = myColor === "white" ? "black" : "white";
  const opponentOnline = players[opponentColor]?.connected ?? true;

  const dotOpponent = document.getElementById("presence-opponent");
  if (dotOpponent) {
    dotOpponent.className = `presence-dot ${opponentOnline ? "online" : "offline"}`;
    dotOpponent.title = opponentOnline ? "Opponent Online" : "Opponent Offline";
  }
}

export function updateRematchState(rematchRequestedBy, myUid) {
  const btn = document.getElementById("btn-rematch");
  if (!btn) return;

  if (!rematchRequestedBy) {
    btn.textContent = "Request Rematch";
    btn.disabled = false;
    btn.classList.remove("rematch-active");
  } else if (rematchRequestedBy === myUid) {
    btn.textContent = "Rematch Offered (Waiting...)";
    btn.disabled = true;
    btn.classList.remove("rematch-active");
  } else {
    btn.textContent = "Accept Rematch!";
    btn.disabled = false;
    btn.classList.add("rematch-active");
  }
}

export function updateClocks(whiteTimeMs, blackTimeMs, myColor) {
  const formatTime = (ms) => {
    const totalSecs = Math.max(0, Math.floor(ms / 1000));
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  const isUnlimited = whiteTimeMs == null || whiteTimeMs === 0;
  const clockMe = document.getElementById("clock-me");
  const clockOpponent = document.getElementById("clock-opponent");

  if (!clockMe || !clockOpponent) return;

  if (isUnlimited) {
    clockMe.classList.add("hidden");
    clockOpponent.classList.add("hidden");
    return;
  }

  clockMe.classList.remove("hidden");
  clockOpponent.classList.remove("hidden");

  const myTime = myColor === "black" ? blackTimeMs : whiteTimeMs;
  const oppTime = myColor === "black" ? whiteTimeMs : blackTimeMs;

  clockMe.textContent = formatTime(myTime);
  clockOpponent.textContent = formatTime(oppTime);

  clockMe.classList.toggle("low-time", myTime < 20000 && myTime > 0);
  clockOpponent.classList.toggle("low-time", oppTime < 20000 && oppTime > 0);
}

export function updateSpectatorCount(count) {
  const pill = document.getElementById("spectator-pill");
  const countEl = document.getElementById("spectator-count");
  if (!pill || !countEl) return;

  countEl.textContent = count;
  pill.classList.toggle("hidden", count <= 0);
}

export function updateReplayControls(currentIndex, totalCount) {
  const btnFirst = document.getElementById("btn-replay-first");
  const btnPrev = document.getElementById("btn-replay-prev");
  const btnNext = document.getElementById("btn-replay-next");
  const btnLive = document.getElementById("btn-replay-live");

  const maxIdx = Math.max(0, totalCount - 1);
  const isLive = currentIndex === -1;
  const hasMoves = totalCount > 1;

  if (btnLive) btnLive.classList.toggle("active", isLive);
  if (btnFirst) btnFirst.disabled = !hasMoves || currentIndex === 0;
  if (btnPrev) btnPrev.disabled = !hasMoves || currentIndex === 0;
  if (btnNext) btnNext.disabled = !hasMoves || isLive || currentIndex >= maxIdx;

  // Clear previous active highlight and set current active move
  document.querySelectorAll(".move-san.active-history").forEach((el) => {
    el.classList.remove("active-history");
  });

  const activeIdx = isLive ? maxIdx : currentIndex;
  if (activeIdx > 0) {
    document.querySelectorAll(`[data-move-idx="${activeIdx}"]`).forEach((el) => {
      el.classList.add("active-history");
    });
  }
}

// ─────────────────────────────────────────────
//  CHAT & PLAYER THOUGHT / SPEECH BUBBLES
// ─────────────────────────────────────────────

let opponentBubbleTimer = null;
let meBubbleTimer = null;

export function showPlayerBubble(target = "me", content = "", type = "emoji", senderName = "") {
  const containerId = target === "opponent" ? "bubble-container-opponent" : "bubble-container-me";
  const container = document.getElementById(containerId);
  if (!container || !content) return;

  if (target === "opponent" && opponentBubbleTimer) clearTimeout(opponentBubbleTimer);
  if (target === "me" && meBubbleTimer) clearTimeout(meBubbleTimer);

  container.innerHTML = "";

  const bubble = document.createElement("div");
  if (type === "emoji") {
    bubble.className = "player-thought-bubble";
    const span = document.createElement("span");
    span.className = "bubble-emoji";
    span.textContent = content;
    bubble.appendChild(span);
  } else {
    bubble.className = "player-speech-bubble";
    if (senderName) {
      const senderEl = document.createElement("span");
      senderEl.className = "bubble-sender";
      senderEl.textContent = senderName;
      bubble.appendChild(senderEl);
    }
    const textEl = document.createElement("span");
    textEl.className = "bubble-text";
    textEl.textContent = content;
    bubble.appendChild(textEl);
  }

  container.appendChild(bubble);

  const duration = type === "emoji" ? 3200 : 4500;
  const timer = setTimeout(() => {
    bubble.classList.add("bubble-fade-out");
    setTimeout(() => {
      bubble.remove();
    }, 350);
  }, duration);

  if (target === "opponent") opponentBubbleTimer = timer;
  else meBubbleTimer = timer;
}

function renderChatMessages(messages = []) {
  const container = document.getElementById("chat-messages");
  if (!container) return;

  if (!messages.length) {
    container.innerHTML = '<div class="chat-empty">No messages yet. Say hello! 👋</div>';
    lastChatLength = 0;
    initialChatLoaded = true;
    return;
  }

  container.innerHTML = "";
  const currentUser = getCurrentUser();
  const myUid = currentUser?.uid;
  const myName = getPlayerName();

  messages.forEach((msg) => {
    const isMe = (msg.senderUid && myUid) ? (msg.senderUid === myUid) : (msg.sender === myName && myName !== "Anonymous" && myName !== "Player");
    const row = document.createElement("div");
    row.className = `chat-msg ${isMe ? "outgoing" : "incoming"}`;

    const sender = document.createElement("span");
    sender.className = "msg-sender";
    sender.textContent = msg.sender || "Player";

    const text = document.createElement("span");
    text.className = "msg-text";
    text.textContent = msg.text;

    row.appendChild(sender);
    row.appendChild(text);
    container.appendChild(row);
  });

  container.scrollTop = container.scrollHeight;

  // When a new message arrives from the opponent, display speech bubble above opponent & show notification!
  if (initialChatLoaded && messages.length > lastChatLength) {
    const latest = messages[messages.length - 1];
    const isMe = (latest.senderUid && myUid) ? (latest.senderUid === myUid) : (latest.sender === myName && myName !== "Anonymous" && myName !== "Player");
    if (!isMe && latest.text) {
      showPlayerBubble("opponent", latest.text, "chat", latest.sender || "Opponent");
      if (!isChatOpen) {
        document.getElementById("chat-unread-dot")?.classList.remove("hidden");
        showToast(`💬 ${latest.sender || "Opponent"}: ${latest.text}`, "default", 3500);
      }
    }
  }

  lastChatLength = messages.length;
  initialChatLoaded = true;
}

function appendChatMessage(msg) {
  const container = document.getElementById("chat-messages");
  if (!container) return;
  const row = document.createElement("div");
  row.className = "chat-msg outgoing";

  const sender = document.createElement("span");
  sender.className = "msg-sender";
  sender.textContent = msg.sender || "Player";

  const text = document.createElement("span");
  text.className = "msg-text";
  text.textContent = msg.text || "";

  row.appendChild(sender);
  row.appendChild(text);
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}

// ─────────────────────────────────────────────
//  DRAW OFFER MODAL
// ─────────────────────────────────────────────

export function showDrawOfferModal() {
  document.getElementById("draw-modal")?.classList.remove("hidden");
}

export function hideDrawOfferModal() {
  document.getElementById("draw-modal")?.classList.add("hidden");
}

// ─────────────────────────────────────────────
//  MATERIAL CALCULATION
// ─────────────────────────────────────────────

const PIECE_VALS = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function getCapturedPieces(chess, myColor) {
  const initialPieces = {
    w: { p: 8, n: 2, b: 2, r: 2, q: 1 },
    b: { p: 8, n: 2, b: 2, r: 2, q: 1 },
  };

  const currentPieces = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 },
  };

  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c];
      if (sq && sq.type !== "k") {
        currentPieces[sq.color][sq.type] =
          (currentPieces[sq.color][sq.type] || 0) + 1;
      }
    }
  }

  const glyphs = {
    w: { p: "♙", n: "♘", b: "♗", r: "♖", q: "♕" },
    b: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛" },
  };

  let capturedByWhite = "";
  let capturedByBlack = "";
  let whiteMaterial = 0;
  let blackMaterial = 0;

  ["q", "r", "b", "n", "p"].forEach((type) => {
    const lostByBlack = (initialPieces.b[type] || 0) - (currentPieces.b[type] || 0);
    const lostByWhite = (initialPieces.w[type] || 0) - (currentPieces.w[type] || 0);

    for (let i = 0; i < lostByBlack; i++) {
      capturedByWhite += glyphs.b[type];
      whiteMaterial += PIECE_VALS[type];
    }
    for (let i = 0; i < lostByWhite; i++) {
      capturedByBlack += glyphs.w[type];
      blackMaterial += PIECE_VALS[type];
    }
  });

  const isWhite = myColor === "white";
  return {
    mine: isWhite ? capturedByWhite : capturedByBlack,
    theirs: isWhite ? capturedByBlack : capturedByWhite,
    myAdvantage: isWhite ? whiteMaterial - blackMaterial : blackMaterial - whiteMaterial,
    opponentAdvantage: isWhite ? blackMaterial - whiteMaterial : whiteMaterial - blackMaterial,
  };
}