// ─────────────────────────────────────────────
//  LabChess — Automated Chess Rules Test Suite
// ─────────────────────────────────────────────

const { Chess } = require("../functions/node_modules/chess.js");

function runTests() {
  console.log("==========================================");
  console.log("  Running LabChess Chess Rules Tests");
  console.log("==========================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${testName}`);
      failed++;
    }
  }

  // 1. Initial Position Test
  {
    const chess = new Chess();
    assert(chess.turn() === "w", "White moves first in initial position");
    assert(chess.moves().length === 20, "20 legal opening moves for White");
    assert(!chess.game_over(), "Game is not over at start");
  }

  // 2. Fool's Mate (Fastest Checkmate)
  {
    const chess = new Chess();
    chess.move("f3");
    chess.move("e5");
    chess.move("g4");
    chess.move("Qh4#");
    assert(chess.in_checkmate(), "Fool's mate is detected as checkmate");
    assert(chess.game_over(), "Game is over on Fool's mate");
    assert(chess.turn() === "w", "White is in checkmate");
  }

  // 3. Kingside Castling
  {
    const chess = new Chess("r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4");
    const move = chess.move("O-O");
    assert(move !== null && move.san === "O-O", "White can castle kingside");
    assert(chess.get("g1")?.type === "k", "King moved to g1 on castle");
    assert(chess.get("f1")?.type === "r", "Rook moved to f1 on castle");
  }

  // 4. Queenside Castling
  {
    const chess = new Chess("r3k2r/pppq1ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPPQ1PPP/R3K2R w KQkq - 0 8");
    const move = chess.move("O-O-O");
    assert(move !== null && move.san === "O-O-O", "White can castle queenside");
    assert(chess.get("c1")?.type === "k", "King moved to c1 on queenside castle");
    assert(chess.get("d1")?.type === "r", "Rook moved to d1 on queenside castle");
  }

  // 5. En Passant Capture
  {
    const chess = new Chess("rnbqkbnr/ppppp1pp/8/4Pp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3");
    const move = chess.move("exf6");
    assert(move !== null && move.flags.includes("e"), "En passant capture is recognized");
    assert(chess.get("f5") === null, "Captured black pawn removed from f5");
    assert(chess.get("f6")?.type === "p", "White pawn placed on f6");
  }

  // 6. Pawn Promotion
  {
    const chess = new Chess("8/4P3/8/8/8/8/8/4K2k w - - 0 1");
    const move = chess.move({ from: "e7", to: "e8", promotion: "q" });
    assert(move !== null && move.san === "e8=Q", "Pawn promotion to Queen succeeds");
    assert(chess.get("e8")?.type === "q", "Queen is present on promotion square e8");
  }

  // 7. Stalemate Detection
  {
    const chess = new Chess("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
    assert(chess.in_stalemate(), "Stalemate position is recognized");
    assert(chess.in_draw(), "Stalemate is a draw");
    assert(chess.game_over(), "Game is over on stalemate");
    assert(!chess.in_check(), "King is not in check during stalemate");
  }

  // 8. Illegal Move Prevention
  {
    const chess = new Chess();
    const illegalMove = chess.move({ from: "e2", to: "e5" });
    assert(illegalMove === null, "Pawn moving 3 squares is rejected as illegal");
    assert(chess.fen() === "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "FEN unchanged after illegal move");
  }

  // 9. Cannot Castle While In Check
  {
    // White king on e1 is in check from Black Queen on e7
    const chess = new Chess("r1bqk2r/ppppqppp/2n2n2/2b5/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 6 5");
    chess.load("r1bqk2r/pppp1ppp/2n2n2/2b5/2B1P3/5N2/PPPPqPPP/RNBQK2R w KQkq - 0 1"); // e2 Queen delivers check
    assert(chess.in_check(), "White king is in check");
    const move = chess.move("O-O");
    assert(move === null, "Castling is illegal while in check");
  }

  // 10. Insufficient Material
  {
    const chess = new Chess("8/8/8/4k3/8/8/8/4K3 w - - 0 1");
    assert(chess.insufficient_material(), "King vs King detected as insufficient material draw");
    assert(chess.in_draw(), "King vs King is a draw");
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exit(1);
}

runTests();
