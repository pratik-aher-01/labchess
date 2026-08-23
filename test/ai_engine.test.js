// ─────────────────────────────────────────────
//  LabChess — Stockfish AI Engine Test Suite
// ─────────────────────────────────────────────

import { getAiMove, AI_DIFFICULTY_PRESETS } from "../js/ai.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Chess } = require("../functions/node_modules/chess.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log("==========================================");
  console.log("  Running LabChess Stockfish AI Engine Tests");
  console.log("==========================================");

  // Test 1: Difficulty Presets Defined
  assert(AI_DIFFICULTY_PRESETS.easy && AI_DIFFICULTY_PRESETS.medium && AI_DIFFICULTY_PRESETS.master, "Stockfish difficulty presets configured");

  // Test 2: AI generates valid opening move for White across all levels
  const chess1 = new Chess();
  const moveEasy = await getAiMove(chess1, "easy");
  assert(moveEasy && moveEasy.from && moveEasy.to, "Casual AI returns valid move format from starting position");

  const moveMed = await getAiMove(chess1, "medium");
  assert(moveMed && moveMed.from && moveMed.to, "Club AI returns valid move format from starting position");

  const moveMaster = await getAiMove(chess1, "master");
  assert(moveMaster && moveMaster.from && moveMaster.to, "Master AI returns valid move format from starting position");

  // Test 3: AI finds immediate 1-ply checkmate (Scholar's Mate final strike)
  // 1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 (White can play Qxf7#)
  const mateInOne = new Chess("r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4");
  const winningMove = await getAiMove(mateInOne, "master");
  assert(winningMove && winningMove.to === "f7", "Master AI detects Scholar's Mate Queen strike on f7");

  // Test 4: AI handles Black turn properly
  const blackTurn = new Chess("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1");
  const blackMove = await getAiMove(blackTurn, "medium");
  assert(blackMove && blackMove.from && blackMove.to, "Club AI plays legal response as Black");

  console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exit(1);
}

runTests();
