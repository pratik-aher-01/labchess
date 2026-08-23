// ─────────────────────────────────────────────
//  LabChess — Confetti & Victory Ribbon System
//  Lightweight, 0-dependency canvas particle engine
//  for celebratory victory ribbon sprinkles.
// ─────────────────────────────────────────────

let canvas = null;
let ctx = null;
let particles = [];
let animationId = null;
let isRunning = false;

const RIBBON_COLORS = [
  "#c9a84c", // Gold
  "#f0d9b5", // Cream
  "#27ae60", // Green
  "#2980b9", // Blue
  "#e74c3c", // Crimson
  "#9b59b6", // Purple
  "#f39c12", // Orange
  "#1abc9c", // Turquoise
];

function initCanvas() {
  canvas = document.getElementById("confetti-canvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "confetti-canvas";
    canvas.style.position = "fixed";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "3500";
    document.body.appendChild(canvas);
  }
  ctx = canvas.getContext("2d");
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
}

function resizeCanvas() {
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

class RibbonParticle {
  constructor(x, y) {
    this.x = x ?? Math.random() * canvas.width;
    this.y = y ?? -20 - Math.random() * 50;
    this.width = 6 + Math.random() * 8;
    this.height = 12 + Math.random() * 16;
    this.color = RIBBON_COLORS[Math.floor(Math.random() * RIBBON_COLORS.length)];
    this.speedY = 2.5 + Math.random() * 4.5;
    this.speedX = -2 + Math.random() * 4;
    this.rotation = Math.random() * 360;
    this.rotationSpeed = -6 + Math.random() * 12;
    this.oscillateSpeed = 0.04 + Math.random() * 0.06;
    this.oscillateOffset = Math.random() * Math.PI * 2;
    this.opacity = 1;
  }

  update() {
    this.y += this.speedY;
    this.x += Math.sin(this.y * this.oscillateSpeed + this.oscillateOffset) * 2 + this.speedX * 0.5;
    this.rotation += this.rotationSpeed;

    if (this.y > canvas.height - 100) {
      this.opacity -= 0.02;
    }
  }

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate((this.rotation * Math.PI) / 180);
    ctx.globalAlpha = Math.max(0, this.opacity);
    ctx.fillStyle = this.color;
    ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);
    ctx.restore();
  }
}

function loop() {
  if (!isRunning || !ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.update();
    p.draw();
    if (p.y > canvas.height + 30 || p.opacity <= 0) {
      particles.splice(i, 1);
    }
  }

  if (particles.length > 0) {
    animationId = requestAnimationFrame(loop);
  } else {
    stopConfetti();
  }
}

export function startVictoryConfetti(durationMs = 4500) {
  initCanvas();
  stopConfetti();

  isRunning = true;
  particles = [];

  // Generate burst of confetti ribbons
  const count = Math.min(180, Math.floor(window.innerWidth / 8));
  for (let i = 0; i < count; i++) {
    const x = Math.random() * canvas.width;
    const y = -20 - Math.random() * (canvas.height * 0.6);
    particles.push(new RibbonParticle(x, y));
  }

  loop();

  // Additional waves
  const waveTimer = setInterval(() => {
    if (!isRunning) {
      clearInterval(waveTimer);
      return;
    }
    for (let i = 0; i < 30; i++) {
      particles.push(new RibbonParticle(Math.random() * canvas.width, -20));
    }
  }, 400);

  setTimeout(() => {
    clearInterval(waveTimer);
  }, durationMs);
}

export function stopConfetti() {
  isRunning = false;
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  if (ctx && canvas) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  particles = [];
}
