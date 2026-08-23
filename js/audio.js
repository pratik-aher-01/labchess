// ─────────────────────────────────────────────
//  LabChess — Web Audio Sound Synthesizer
//  Generates realistic chess audio effects using
//  pure Web Audio API (0 KB external files).
// ─────────────────────────────────────────────

let audioCtx = null;
let soundEnabled = true;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

// ── Move Sound (Soft Wood Tap) ──
export function playMoveSound() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(320, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.06);

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.06);
  } catch (e) {}
}

// ── Capture Sound (Crisp Snapping Impact) ──
export function playCaptureSound() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = "triangle";
    osc1.frequency.setValueAtTime(540, ctx.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.08);

    osc2.type = "sine";
    osc2.frequency.setValueAtTime(260, ctx.currentTime);
    osc2.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.08);

    gain.gain.setValueAtTime(0.45, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start();
    osc2.start();
    osc1.stop(ctx.currentTime + 0.08);
    osc2.stop(ctx.currentTime + 0.08);
  } catch (e) {}
}

// ── Check Alert Sound (Harmonic Double Ping) ──
export function playCheckSound() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    [480, 720].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const startTime = ctx.currentTime + i * 0.07;

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.8, startTime + 0.12);

      gain.gain.setValueAtTime(0.3, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.12);
    });
  } catch (e) {}
}

// ── Game Over Sound (Victory / Draw Chords) ──
export function playGameOverSound(isWin) {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const notes = isWin ? [330, 415, 494, 659] : [400, 370, 330, 260];

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const startTime = ctx.currentTime + idx * 0.1;

      osc.type = isWin ? "triangle" : "sine";
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.25, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.45);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.45);
    });
  } catch (e) {}
}

export function toggleSound() {
  soundEnabled = !soundEnabled;
  return soundEnabled;
}

export function isSoundEnabled() {
  return soundEnabled;
}
