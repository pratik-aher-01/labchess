// ─────────────────────────────────────────────
//  LabChess — Board Module
//  Handles chessboard.js initialization,
//  piece drag & drop, legal move hints,
//  square highlights, and board orientation.
// ─────────────────────────────────────────────

import { tryMove, getLegalMovesForSquare, isMyPiece, needsPromotion, isMyTurn, isGameOver } from "./game.js";

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────

let board         = null;   // chessboard.js instance
let pendingMove   = null;   // { from, to } waiting for promotion pick
let isFlipped     = false;  // black plays from bottom

// ─────────────────────────────────────────────
//  INIT BOARD
//  Creates the chessboard.js instance.
//  Called once when the game screen appears.
// ─────────────────────────────────────────────

export function initBoard(fen = "start") {
  board = Chessboard("chessboard", {
    position:     fen,
    draggable:    true,
    dropOffBoard: "snapback",
    sparePieces:  false,
    pieceTheme:   "https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png",

    onDragStart,
    onDrop,
    onMouseoverSquare,
    onMouseoutSquare,
    onSnapEnd,
  });

  console.log("[Board] Initialized");
}

// ─────────────────────────────────────────────
//  DRAG CALLBACKS
// ─────────────────────────────────────────────

function onDragStart(source, piece) {
  // Block drag if game is over or not my turn
  if (isGameOver()) return false;
  if (!isMyTurn()) return false;
  if (!isMyPiece(source)) return false;

  // Show legal move hints
  clearLegalMoves();
  const legalMoves = getLegalMovesForSquare(source);
  showLegalMoves(legalMoves);

  return true;
}

function onDrop(source, target) {
  clearLegalMoves();

  if (source === target) return "snapback";

  // Check for pawn promotion
  if (needsPromotion(source, target)) {
    pendingMove = { from: source, to: target };
    showPromotionModal(source);
    return; // don't snap back — wait for promotion pick
  }

  // Try the move
  const success = tryMove(source, target);
  if (!success) return "snapback";
}

function onMouseoverSquare(square) {
  if (!isMyTurn() || isGameOver()) return;
  if (!isMyPiece(square)) return;

  const legalMoves = getLegalMovesForSquare(square);
  if (legalMoves.length > 0) {
    showLegalMoves(legalMoves);
  }
}

function onMouseoutSquare() {
  clearLegalMoves();
}

function onSnapEnd() {
  // Sync board visual with chess.js state via global
  if (window._labchess_fen) {
    board?.position(window._labchess_fen, false);
  }
}

// ─────────────────────────────────────────────
//  RENDER POSITION
//  Updates the board visuals to a given FEN.
// ─────────────────────────────────────────────

export function renderPosition(fen, animate = true) {
  if (!board) return;
  board.position(fen, animate);
}

// ─────────────────────────────────────────────
//  FLIP BOARD
//  Orients the board so black plays from bottom.
// ─────────────────────────────────────────────

export function flipBoard() {
  if (!board) return;
  isFlipped = true;
  board.flip();
}

// ─────────────────────────────────────────────
//  HIGHLIGHT LAST MOVE
//  Colors the from/to squares of the last move.
// ─────────────────────────────────────────────

export function highlightLastMove(from, to) {
  clearHighlights();
  colorSquare(from, "highlight-from");
  colorSquare(to,   "highlight-to");
}

// ─────────────────────────────────────────────
//  HIGHLIGHT CHECK
//  Highlights the king square red when in check.
// ─────────────────────────────────────────────

export function highlightCheck(square) {
  colorSquare(square, "highlight-check");
}

// ─────────────────────────────────────────────
//  CLEAR HIGHLIGHTS
// ─────────────────────────────────────────────

export function clearHighlights() {
  document.querySelectorAll(".highlight-from, .highlight-to, .highlight-check")
    .forEach(el => {
      el.classList.remove("highlight-from", "highlight-to", "highlight-check");
    });
}

// ─────────────────────────────────────────────
//  LEGAL MOVE HINTS
//  Dots on empty squares, rings on capturable pieces.
// ─────────────────────────────────────────────

export function showLegalMoves(moves) {
  moves.forEach(({ to, isCapture }) => {
    const sq = getSquareEl(to);
    if (!sq) return;
    sq.classList.add(isCapture ? "legal-capture-ring" : "legal-move-dot");
  });
}

export function clearLegalMoves() {
  document.querySelectorAll(".legal-move-dot, .legal-capture-ring")
    .forEach(el => {
      el.classList.remove("legal-move-dot", "legal-capture-ring");
    });
}

// ─────────────────────────────────────────────
//  PROMOTION MODAL
//  Shows a piece picker when pawn reaches last rank.
// ─────────────────────────────────────────────

function showPromotionModal(fromSquare) {
  // Determine color from the piece on fromSquare
  const pieceEl = document.querySelector(`[data-square="${fromSquare}"] .piece-417db`);
  const isWhite = pieceEl?.getAttribute("data-piece")?.startsWith("w") ?? true;

  const pieces = isWhite
    ? [{ p: "q", icon: "♛" }, { p: "r", icon: "♜" }, { p: "b", icon: "♝" }, { p: "n", icon: "♞" }]
    : [{ p: "q", icon: "♛" }, { p: "r", icon: "♜" }, { p: "b", icon: "♝" }, { p: "n", icon: "♞" }];

  // Remove any existing modal
  removePromotionModal();

  const modal = document.createElement("div");
  modal.className   = "promotion-modal";
  modal.id          = "promotion-modal";

  pieces.forEach(({ p, icon }) => {
    const btn = document.createElement("div");
    btn.className      = "promotion-piece";
    btn.textContent    = icon;
    btn.title          = getPieceName(p);
    btn.addEventListener("click", () => {
      removePromotionModal();
      if (pendingMove) {
        tryMove(pendingMove.from, pendingMove.to, p);
        pendingMove = null;
      }
    });
    modal.appendChild(btn);
  });

  document.querySelector(".board-wrap")?.appendChild(modal);
}

function removePromotionModal() {
  document.getElementById("promotion-modal")?.remove();
}

function getPieceName(p) {
  return { q: "Queen", r: "Rook", b: "Bishop", n: "Knight" }[p] || "";
}

// ─────────────────────────────────────────────
//  GAME OVER OVERLAY
//  Shows result message over the board.
// ─────────────────────────────────────────────

export function showOverlay(emoji, title, sub) {
  const overlay = document.getElementById("board-overlay");
  const msg     = document.getElementById("overlay-message");
  if (!overlay || !msg) return;

  msg.innerHTML = `
    <span class="result-emoji">${emoji}</span>
    ${title}
    <span class="result-sub">${sub}</span>
  `;

  overlay.classList.remove("hidden");
}

export function hideOverlay() {
  document.getElementById("board-overlay")?.classList.add("hidden");
}

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────

function colorSquare(square, className) {
  const el = getSquareEl(square);
  if (el) el.classList.add(className);
}

function getSquareEl(square) {
  return document.querySelector(`[data-square="${square}"]`);
}