// ─────────────────────────────────────────────
//  LabChess — Board Module (Production-Ready)
//  Handles chessboard.js lifecycle, responsive
//  scaling, Drag & Drop + Mobile Tap-to-Move,
//  square highlights, and promotion modals.
// ─────────────────────────────────────────────

import {
  tryMove,
  getLegalMovesForSquare,
  isMyPiece,
  needsPromotion,
  isMyTurn,
  isGameOver,
  getPiece,
} from "./game.js";

let boardInstance = null;
let pendingPromotionMove = null;
let currentOrientation = "white";
let selectedSquare = null;
let lastInteractionTime = 0;
let isReadOnly = false;

export function setBoardReadOnly(val) {
  isReadOnly = !!val;
}

export function isBoardReadOnly() {
  return isReadOnly;
}

export function flipBoardOrientation() {
  if (!boardInstance) return currentOrientation;
  currentOrientation = currentOrientation === "white" ? "black" : "white";
  if (typeof boardInstance.orientation === "function") {
    boardInstance.orientation(currentOrientation);
  } else if (typeof boardInstance.flip === "function") {
    boardInstance.flip();
  }
  return currentOrientation;
}

export function getCurrentOrientation() {
  return currentOrientation || "white";
}

// ─────────────────────────────────────────────
//  INIT BOARD
// ─────────────────────────────────────────────

export function initBoard(fen = "start") {
  if (boardInstance) {
    boardInstance.position(fen, false);
    return;
  }

  boardInstance = Chessboard("chessboard", {
    position: fen,
    draggable: true,
    dropOffBoard: "snapback",
    sparePieces: false,
    pieceTheme: "https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png",
    onDragStart,
    onDrop,
    onMouseoverSquare,
    onMouseoutSquare,
    onSnapEnd,
  });

  setupClickAndTapToMove();

  window.addEventListener("resize", () => {
    if (boardInstance) {
      boardInstance.resize();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      cancelPromotion();
    }
  });

  console.log("[Board] Initialized with seamless Click & Tap-to-Move");
}

// ─────────────────────────────────────────────
//  SELECTION & TAP-TO-MOVE ENGINE
// ─────────────────────────────────────────────

function selectSquare(square) {
  if (isReadOnly) return;
  selectedSquare = square;
  clearHighlights();
  clearLegalMoves();
  colorSquare(square, "highlight-selected");

  const legalMoves = getLegalMovesForSquare(square);
  showLegalMoves(legalMoves);
}

export function clearSelection() {
  selectedSquare = null;
  document.querySelectorAll(".highlight-selected").forEach((el) => {
    el.classList.remove("highlight-selected");
  });
  clearLegalMoves();
}

function handleSquareTap(square) {
  if (isReadOnly || isGameOver() || !isMyTurn() || !square) return;

  // Case 1: Tapping a friendly piece
  if (isMyPiece(square)) {
    if (selectedSquare === square) {
      // Tapping already-selected piece deselects it
      clearSelection();
    } else {
      // Select or switch piece
      selectSquare(square);
    }
    return;
  }

  // Case 2: Tapping destination square when a piece is selected
  if (selectedSquare) {
    const from = selectedSquare;
    const to = square;

    if (needsPromotion(from, to)) {
      pendingPromotionMove = { from, to };
      clearSelection();
      showPromotionModal(from);
      return;
    }

    const success = tryMove(from, to);
    clearSelection();

    if (!success) {
      clearHighlights();
    }
  }
}

// ─────────────────────────────────────────────
//  TOUCH & CLICK EVENT DELEGATION
// ─────────────────────────────────────────────

function setupClickAndTapToMove() {
  const boardEl = document.getElementById("chessboard");
  if (!boardEl) return;

  const findSquare = (e) => {
    let clientX = e.clientX;
    let clientY = e.clientY;

    if (e.changedTouches && e.changedTouches.length > 0) {
      clientX = e.changedTouches[0].clientX;
      clientY = e.changedTouches[0].clientY;
    } else if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }

    if (clientX !== undefined && clientY !== undefined) {
      const el = document.elementFromPoint(clientX, clientY);
      const squareEl = el?.closest("[data-square]");
      if (squareEl) {
        return squareEl.getAttribute("data-square");
      }
    }

    const fallbackEl = e.target?.closest?.("[data-square]");
    return fallbackEl?.getAttribute("data-square") || null;
  };

  let touchStartX = 0;
  let touchStartY = 0;
  let hasMoved = false;

  boardEl.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        hasMoved = false;
      }
    },
    { passive: true }
  );

  boardEl.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length === 1) {
        const dx = Math.abs(e.touches[0].clientX - touchStartX);
        const dy = Math.abs(e.touches[0].clientY - touchStartY);
        if (dx > 8 || dy > 8) {
          hasMoved = true;
        }
      }
    },
    { passive: true }
  );

  boardEl.addEventListener(
    "touchend",
    (e) => {
      if (!hasMoved) {
        lastInteractionTime = Date.now();
        const sq = findSquare(e);
        if (sq) {
          handleSquareTap(sq);
        }
      }
    },
    { passive: true }
  );

  // Desktop click listener (filtered against mobile touch ghost clicks)
  boardEl.addEventListener("click", (e) => {
    if (Date.now() - lastInteractionTime < 400) return;
    const sq = findSquare(e);
    if (sq) {
      handleSquareTap(sq);
    }
  });
}

// ─────────────────────────────────────────────
//  DRAG & DROP HANDLERS
// ─────────────────────────────────────────────

function onDragStart(source, piece) {
  if (isReadOnly) return false;
  if (isGameOver()) return false;
  if (!isMyTurn()) return false;
  if (!isMyPiece(source)) return false;

  // Highlight piece and show moves immediately on drag start
  selectSquare(source);
  return true;
}

function onDrop(source, target) {
  // If dropped on the same square, keep it selected for Tap-to-Move!
  if (source === target || target === "offboard") {
    return "snapback";
  }

  // Dropped on another square: execute move
  if (needsPromotion(source, target)) {
    pendingPromotionMove = { from: source, to: target };
    clearSelection();
    showPromotionModal(source);
    return;
  }

  const success = tryMove(source, target);
  clearSelection();

  if (!success) return "snapback";
}

function onMouseoverSquare(square) {
  if (selectedSquare) return;
  if (!isMyTurn() || isGameOver()) return;
  if (!isMyPiece(square)) return;

  const legalMoves = getLegalMovesForSquare(square);
  if (legalMoves.length > 0) {
    showLegalMoves(legalMoves);
  }
}

function onMouseoutSquare() {
  if (selectedSquare) return;
  clearLegalMoves();
}

function onSnapEnd() {
  if (window._labchess_fen && boardInstance) {
    boardInstance.position(window._labchess_fen, false);
  }
}

// ─────────────────────────────────────────────
//  BOARD CONTROLS & ORIENTATION
// ─────────────────────────────────────────────

export function renderPosition(fen, animate = true) {
  if (!boardInstance) return;
  boardInstance.position(fen, animate);
}

export function flipBoard() {
  if (!boardInstance) return;
  boardInstance.flip();
  currentOrientation = currentOrientation === "white" ? "black" : "white";
}

export function setBoardOrientation(color) {
  if (!boardInstance) return;
  currentOrientation = color === "black" ? "black" : "white";
  boardInstance.orientation(currentOrientation);
}

// ─────────────────────────────────────────────
//  HIGHLIGHTS
// ─────────────────────────────────────────────

export function highlightLastMove(from, to) {
  clearHighlights();
  colorSquare(from, "highlight-from");
  colorSquare(to, "highlight-to");
}

export function highlightCheck(square) {
  colorSquare(square, "highlight-check");
}

export function clearHighlights() {
  document
    .querySelectorAll(
      ".highlight-from, .highlight-to, .highlight-check, .highlight-selected"
    )
    .forEach((el) => {
      el.classList.remove(
        "highlight-from",
        "highlight-to",
        "highlight-check",
        "highlight-selected"
      );
    });
}

export function showLegalMoves(moves) {
  moves.forEach(({ to, isCapture }) => {
    const sq = getSquareEl(to);
    if (!sq) return;
    sq.classList.add(isCapture ? "legal-capture-ring" : "legal-move-dot");
  });
}

export function clearLegalMoves() {
  document
    .querySelectorAll(".legal-move-dot, .legal-capture-ring")
    .forEach((el) => {
      el.classList.remove("legal-move-dot", "legal-capture-ring");
    });
}

function colorSquare(square, className) {
  const el = getSquareEl(square);
  if (el) el.classList.add(className);
}

function getSquareEl(square) {
  return document.querySelector(`[data-square="${square}"]`);
}

// ─────────────────────────────────────────────
//  PROMOTION MODAL
// ─────────────────────────────────────────────

function showPromotionModal(fromSquare) {
  removePromotionModal();

  const piece = getPiece(fromSquare);
  const isWhite = piece ? piece.color === "w" : currentOrientation === "white";

  const pieces = [
    { p: "q", icon: isWhite ? "♕" : "♛", name: "Queen" },
    { p: "r", icon: isWhite ? "♖" : "♜", name: "Rook" },
    { p: "b", icon: isWhite ? "♗" : "♝", name: "Bishop" },
    { p: "n", icon: isWhite ? "♘" : "♞", name: "Knight" },
  ];

  const backdrop = document.createElement("div");
  backdrop.className = "promotion-backdrop";
  backdrop.id = "promotion-backdrop";
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      cancelPromotion();
    }
  });

  const modal = document.createElement("div");
  modal.className = "promotion-modal";
  modal.id = "promotion-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-label", "Pawn Promotion Selection");

  pieces.forEach(({ p, icon, name }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "promotion-piece";
    btn.textContent = icon;
    btn.title = name;
    btn.setAttribute("aria-label", `Promote to ${name}`);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const move = pendingPromotionMove;
      removePromotionModal();
      if (move) {
        tryMove(move.from, move.to, p);
        pendingPromotionMove = null;
      }
    });
    modal.appendChild(btn);
  });

  backdrop.appendChild(modal);
  document.querySelector(".board-wrap")?.appendChild(backdrop);
}

export function cancelPromotion() {
  removePromotionModal();
  pendingPromotionMove = null;
  clearHighlights();
  onSnapEnd();
}

function removePromotionModal() {
  document.getElementById("promotion-backdrop")?.remove();
  document.getElementById("promotion-modal")?.remove();
}

// ─────────────────────────────────────────────
//  UNIFIED GAME OVER POP-UP MODAL
// ─────────────────────────────────────────────

export function showOverlay(emoji, title, sub) {
  const modal = document.getElementById("gameover-modal");
  const emojiEl = document.getElementById("gameover-emoji");
  const titleEl = document.getElementById("gameover-title");
  const subEl = document.getElementById("gameover-sub");

  if (!modal) return;

  if (emojiEl) emojiEl.textContent = emoji;
  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = sub;

  modal.classList.remove("hidden");
}

export function hideOverlay() {
  document.getElementById("gameover-modal")?.classList.add("hidden");
}