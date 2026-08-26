// ─────────────────────────────────────────────
//  LabChess — Stockfish AI Engine Module
//  Powered by Stockfish Chess Engine (UCI)
//  with multi-level skill configuration:
//    - Casual / Easy (~900 ELO)
//    - Club Player (~1600 ELO)
//    - Grandmaster / Master (~2500+ ELO)
// ─────────────────────────────────────────────

// Difficulty level presets for Stockfish UCI engine
export const AI_DIFFICULTY_PRESETS = {
  easy: {
    skillLevel: 0,
    depth: 4,
    movetime: 150,
    maxError: 500,
    probability: 300,
    label: "Casual (~900 ELO)",
  },
  medium: {
    skillLevel: 8,
    depth: 8,
    movetime: 350,
    maxError: 150,
    probability: 800,
    label: "Club (~1600 ELO)",
  },
  master: {
    skillLevel: 20,
    depth: 14,
    movetime: 650,
    maxError: 0,
    probability: 1000,
    label: "Grandmaster (~2500+ ELO)",
  },
};

let stockfishWorker = null;
let isEngineReady = false;
let readyResolvers = [];

/**
 * Initializes or retrieves the active Stockfish Web Worker instance.
 */
export function initStockfish() {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    return null;
  }

  if (stockfishWorker) {
    return stockfishWorker;
  }

  try {
    // Instantiate Stockfish from local vendor bundle
    stockfishWorker = new Worker("js/vendor/stockfish.js");

    stockfishWorker.onmessage = (event) => {
      const line = typeof event === "string" ? event : event.data;
      if (typeof line !== "string") return;

      if (line === "readyok" || line.includes("uciok")) {
        isEngineReady = true;
        readyResolvers.forEach((resolve) => resolve());
        readyResolvers = [];
      }
    };

    stockfishWorker.postMessage("uci");
    stockfishWorker.postMessage("isready");

    return stockfishWorker;
  } catch (err) {
    console.warn("[AI] Stockfish worker initialization failed, fallback active:", err.message);
    stockfishWorker = null;
    return null;
  }
}

/**
 * Waits until Stockfish engine has finished initializing
 */
function ensureEngineReady(worker) {
  if (isEngineReady) return Promise.resolve();
  return new Promise((resolve) => {
    readyResolvers.push(resolve);
    worker.postMessage("isready");
    setTimeout(resolve, 1500);
  });
}

/**
 * Queries Stockfish engine for the best move from a given FEN position.
 * @param {string} fen - Current chess FEN
 * @param {string} level - "easy" | "medium" | "master"
 * @returns {Promise<{from: string, to: string, promotion: string|null}|null>}
 */
export async function getStockfishMove(fen, level = "medium") {
  const worker = initStockfish();
  if (!worker) return null;

  await ensureEngineReady(worker);

  const preset = AI_DIFFICULTY_PRESETS[level] || AI_DIFFICULTY_PRESETS.medium;

  return new Promise((resolve) => {
    let hasResolved = false;

    const cleanup = () => {
      if (stockfishWorker) {
        stockfishWorker.removeEventListener("message", messageHandler);
      }
    };

    const messageHandler = (event) => {
      const line = typeof event === "string" ? event : event.data;
      if (typeof line !== "string") return;

      if (line.startsWith("bestmove")) {
        cleanup();
        if (hasResolved) return;
        hasResolved = true;

        const parts = line.split(" ");
        const uciMove = parts[1]; // e.g. "e2e4" or "e7e8q"
        if (!uciMove || uciMove === "(none)") {
          resolve(null);
          return;
        }

        const from = uciMove.slice(0, 2);
        const to = uciMove.slice(2, 4);
        const promotion = uciMove.length > 4 ? uciMove[4].toLowerCase() : null;

        resolve({ from, to, promotion });
      }
    };

    worker.addEventListener("message", messageHandler);

    // Configure Stockfish skill level & parameters
    worker.postMessage("ucinewgame");
    worker.postMessage(`setoption name Skill Level value ${preset.skillLevel}`);
    if (preset.maxError > 0) {
      worker.postMessage(`setoption name Skill Level Maximum Error value ${preset.maxError}`);
      worker.postMessage(`setoption name Skill Level Probability value ${preset.probability}`);
    }

    // Set position and search
    worker.postMessage(`position fen ${fen}`);
    worker.postMessage(`go depth ${preset.depth} movetime ${preset.movetime}`);

    // Fallback timeout
    setTimeout(() => {
      if (!hasResolved) {
        hasResolved = true;
        cleanup();
        resolve(null);
      }
    }, preset.movetime + 2000);
  });
}

// ─────────────────────────────────────────────
//  FAST FALLBACK / SYNC EVALUATION ENGINE
// ─────────────────────────────────────────────

const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

const PST_PAWN = [
  0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
   5,  5, 10, 25, 25, 10,  5,  5,
   0,  0,  0, 20, 20,  0,  0,  0,
   5, -5,-10,  0,  0,-10, -5,  5,
   5, 10, 10,-20,-20, 10, 10,  5,
   0,  0,  0,  0,  0,  0,  0,  0
];

const PST_KNIGHT = [
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,  0,  0,  0,  0,-20,-40,
  -30,  0, 10, 15, 15, 10,  0,-30,
  -30,  5, 15, 20, 20, 15,  5,-30,
  -30,  0, 15, 20, 20, 15,  0,-30,
  -30,  5, 10, 15, 15, 10,  5,-30,
  -40,-20,  0,  5,  5,  0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50
];

const PST_BISHOP = [
  -20,-10,-10,-10,-10,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5, 10, 10,  5,  0,-10,
  -10,  5,  5, 10, 10,  5,  5,-10,
  -10,  0, 10, 10, 10, 10,  0,-10,
  -10, 10, 10, 10, 10, 10, 10,-10,
  -10,  5,  0,  0,  0,  0,  5,-10,
  -20,-10,-10,-10,-10,-10,-10,-20
];

const PST_ROOK = [
    0,  0,  0,  0,  0,  0,  0,  0,
    5, 10, 10, 10, 10, 10, 10,  5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
    0,  0,  0,  5,  5,  0,  0,  0
];

const PST_QUEEN = [
  -20,-10,-10, -5, -5,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5,  5,  5,  5,  0,-10,
   -5,  0,  5,  5,  5,  5,  0, -5,
    0,  0,  5,  5,  5,  5,  0, -5,
  -10,  5,  5,  5,  5,  5,  0,-10,
  -10,  0,  5,  0,  0,  0,  0,-10,
  -20,-10,-10, -5, -5,-10,-10,-20
];

const PST_KING_MID = [
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -20,-30,-30,-40,-40,-30,-30,-20,
  -10,-20,-20,-20,-20,-20,-20,-10,
   20, 20,  0,  0,  0,  0, 20, 20,
   20, 30, 10,  0,  0, 10, 30, 20
];

function getSquareIndex(square, isWhite) {
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1], 10) - 1;
  const row = isWhite ? 7 - rank : rank;
  return row * 8 + file;
}

export function evaluateBoard(chess) {
  if (chess.in_checkmate()) {
    return chess.turn() === "w" ? -99999 : 99999;
  }
  if (chess.in_draw() || chess.in_stalemate()) {
    return 0;
  }

  let totalEvaluation = 0;
  const board = chess.board();

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;

      const isWhite = piece.color === "w";
      const value = PIECE_VALUES[piece.type] || 0;
      let positional = 0;
      const file = "abcdefgh"[c];
      const rank = 8 - r;
      const square = `${file}${rank}`;
      const sqIdx = getSquareIndex(square, isWhite);

      switch (piece.type) {
        case "p": positional = PST_PAWN[sqIdx] || 0; break;
        case "n": positional = PST_KNIGHT[sqIdx] || 0; break;
        case "b": positional = PST_BISHOP[sqIdx] || 0; break;
        case "r": positional = PST_ROOK[sqIdx] || 0; break;
        case "q": positional = PST_QUEEN[sqIdx] || 0; break;
        case "k": positional = PST_KING_MID[sqIdx] || 0; break;
      }

      if (isWhite) totalEvaluation += value + positional;
      else totalEvaluation -= (value + positional);
    }
  }

  return totalEvaluation;
}

function orderMoves(moves) {
  return moves.sort((a, b) => {
    let scoreA = 0;
    let scoreB = 0;
    if (a.flags.includes("c") || a.captured) scoreA += 10;
    if (b.flags.includes("c") || b.captured) scoreB += 10;
    if (a.flags.includes("p") || a.promotion) scoreA += 9;
    if (b.flags.includes("p") || b.promotion) scoreB += 9;
    return scoreB - scoreA;
  });
}

function fallbackMinimax(chess, depth, alpha, beta, isMaximizing) {
  if (depth === 0 || chess.game_over()) {
    return evaluateBoard(chess);
  }

  const legalMoves = orderMoves(chess.moves({ verbose: true }));

  if (isMaximizing) {
    let maxEval = -Infinity;
    for (const move of legalMoves) {
      chess.move(move);
      if (chess.in_checkmate()) {
        chess.undo();
        return 99999;
      }
      const evalScore = fallbackMinimax(chess, depth - 1, alpha, beta, false);
      chess.undo();
      maxEval = Math.max(maxEval, evalScore);
      alpha = Math.max(alpha, evalScore);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const move of legalMoves) {
      chess.move(move);
      if (chess.in_checkmate()) {
        chess.undo();
        return -99999;
      }
      const evalScore = fallbackMinimax(chess, depth - 1, alpha, beta, true);
      chess.undo();
      minEval = Math.min(minEval, evalScore);
      beta = Math.min(beta, evalScore);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

export function getFallbackMove(chess, level = "medium") {
  const legalMoves = chess.moves({ verbose: true });
  if (!legalMoves.length) return null;

  const isWhite = chess.turn() === "w";

  if (level === "easy") {
    if (Math.random() < 0.6) {
      return legalMoves[Math.floor(Math.random() * legalMoves.length)];
    }
  }

  const depth = level === "master" ? 2 : 1;
  let bestMove = legalMoves[0];
  let bestScore = isWhite ? -Infinity : Infinity;

  for (const move of orderMoves(legalMoves)) {
    chess.move(move);
    if (chess.in_checkmate()) {
      chess.undo();
      return move;
    }
    const score = fallbackMinimax(chess, depth, -Infinity, Infinity, !isWhite);
    chess.undo();

    if (isWhite) {
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    } else {
      if (score < bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }
  }

  return bestMove;
}

/**
 * Main AI move entry point.
 * Uses Stockfish Web Worker in browser environments,
 * and seamlessly falls back to positional minimax if worker is unavailable.
 *
 * @param {Chess} chess - chess.js instance
 * @param {string} level - "easy" | "medium" | "master"
 * @returns {Promise<object>|object} Move object { from, to, promotion }
 */
export async function getAiMove(chess, level = "medium") {
  if (!chess) return null;
  const legalMoves = chess.moves({ verbose: true });
  if (!legalMoves.length) return null;

  // Try Stockfish Web Worker if in browser environment
  if (typeof window !== "undefined" && typeof Worker !== "undefined") {
    try {
      const sfMove = await getStockfishMove(chess.fen(), level);
      if (sfMove && sfMove.from && sfMove.to) {
        // Validate against chess.js legal moves to ensure correctness
        const matched = legalMoves.find(
          (m) => m.from === sfMove.from && m.to === sfMove.to && (!sfMove.promotion || m.promotion === sfMove.promotion)
        );
        if (matched) return matched;
      }
    } catch (e) {
      console.warn("[AI] Stockfish evaluation exception, using fallback:", e);
    }
  }

  // Fix #20: Notify the UI that we are using the weaker fallback engine
  // so the user is not surprised by lower AI quality.
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent("labchess:ai-fallback", { detail: { level } }));
  }

  // Fallback minimax engine
  return getFallbackMove(chess, level);
}
