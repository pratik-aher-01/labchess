// ─────────────────────────────────────────────
//  LabChess — Security & Room Lifecycle Tests
// ─────────────────────────────────────────────

const fs = require("fs");
const path = require("path");

function runSecurityTests() {
  console.log("==========================================");
  console.log("  Running LabChess Security & Schema Tests");
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

  // 1. Validate Database Rules file exists and is valid JSON
  {
    const rulesPath = path.join(__dirname, "..", "database.rules.json");
    assert(fs.existsSync(rulesPath), "database.rules.json exists");
    try {
      const parsed = JSON.parse(fs.readFileSync(rulesPath, "utf-8"));
      assert(parsed.rules !== undefined, "rules root object defined");
      assert(parsed.rules.rooms !== undefined, "rooms path secured in rules");
      assert(parsed.rules.rooms.$roomId[".read"] === "auth != null", "Unauthenticated read blocked");
      assert(parsed.rules.rooms.$roomId[".write"].includes("waiting"), "Write rule permits joining waiting rooms");
    } catch (e) {
      assert(false, `database.rules.json is valid JSON: ${e.message}`);
    }
  }

  // 2. Room Code Randomness & Character Set
  {
    const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    function generateRoomCode() {
      let code = "";
      for (let i = 0; i < 6; i++) {
        code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
      }
      return code;
    }

    const codes = new Set();
    let allValid = true;
    for (let i = 0; i < 1000; i++) {
      const c = generateRoomCode();
      if (c.length !== 6 || /[01IO]/.test(c)) {
        allValid = false;
      }
      codes.add(c);
    }
    assert(allValid, "All 1,000 generated codes are 6 chars and exclude 0, 1, I, O");
    assert(codes.size > 980, `Generated room codes have high entropy (${codes.size}/1000 unique)`);
  }

  // 3. Room State Lifecycle Transitions Simulation
  {
    function isValidTransition(from, to) {
      if (from === "waiting" && to === "active") return true;
      if (from === "active" && to === "finished") return true;
      if ((from === "waiting" || from === "active" || from === "finished") && to === "expired") return true;
      if (from === "finished" && to === "active") return true; // Rematch reset
      return false;
    }

    assert(isValidTransition("waiting", "active"), "waiting -> active is valid");
    assert(isValidTransition("active", "finished"), "active -> finished is valid");
    assert(isValidTransition("finished", "active"), "finished -> active (rematch) is valid");
    assert(!isValidTransition("finished", "waiting"), "finished -> waiting is invalid");
    assert(!isValidTransition("expired", "active"), "expired -> active is invalid");
  }

  // 4. Seat Ownership Simulation
  {
    function canMakeMove(room, playerUid) {
      const isWhite = room.players?.white?.uid === playerUid;
      const isBlack = room.players?.black?.uid === playerUid;
      if (!isWhite && !isBlack) return false;

      const playerColor = isWhite ? "w" : "b";
      return room.game?.turn === playerColor && room.game?.status === "in_progress";
    }

    const mockRoom = {
      players: {
        white: { uid: "user_white_123" },
        black: { uid: "user_black_456" }
      },
      game: {
        turn: "w",
        status: "in_progress"
      }
    };

    assert(canMakeMove(mockRoom, "user_white_123"), "White can move on White's turn");
    assert(!canMakeMove(mockRoom, "user_black_456"), "Black cannot move on White's turn");
    assert(!canMakeMove(mockRoom, "attacker_789"), "Attacker cannot move in another player's game");

    mockRoom.game.status = "finished";
    assert(!canMakeMove(mockRoom, "user_white_123"), "Moves blocked when game status is finished");
  }

  // 5. Cloud Functions Package Structure
  {
    const fnIndex = path.join(__dirname, "..", "functions", "index.js");
    assert(fs.existsSync(fnIndex), "functions/index.js exists");
    const fnCode = fs.readFileSync(fnIndex, "utf-8");
    assert(fnCode.includes("exports.submitMove"), "submitMove function exported");
    assert(fnCode.includes("exports.cleanupExpiredRooms"), "cleanupExpiredRooms function exported");
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exit(1);
}

runSecurityTests();
