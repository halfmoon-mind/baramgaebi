const canvas = document.querySelector("#aimCanvas");
const ctx = canvas.getContext("2d");

const modeButtons = [...document.querySelectorAll(".mode-button")];
const durationSelect = document.querySelector("#durationSelect");
const sizeRange = document.querySelector("#sizeRange");
const speedRange = document.querySelector("#speedRange");
const startButton = document.querySelector("#startButton");
const resetButton = document.querySelector("#resetButton");
const againButton = document.querySelector("#againButton");
const resultOverlay = document.querySelector("#resultOverlay");

const scoreValue = document.querySelector("#scoreValue");
const accuracyValue = document.querySelector("#accuracyValue");
const reactionValue = document.querySelector("#reactionValue");
const streakValue = document.querySelector("#streakValue");
const timerValue = document.querySelector("#timerValue");
const statusDot = document.querySelector("#statusDot");
const statusText = document.querySelector("#statusText");
const finalScore = document.querySelector("#finalScore");
const finalAccuracy = document.querySelector("#finalAccuracy");
const finalReaction = document.querySelector("#finalReaction");

const state = {
  mode: "flick",
  running: false,
  paused: false,
  width: 0,
  height: 0,
  dpr: 1,
  remainingMs: 45000,
  lastFrame: 0,
  score: 0,
  hits: 0,
  shots: 0,
  streak: 0,
  bestStreak: 0,
  reactions: [],
  targets: [],
  effects: [],
  pointer: {
    x: 0,
    y: 0,
    down: false,
    inside: false,
  },
  tracking: {
    firingMs: 0,
    lockedMs: 0,
    currentLockMs: 0,
    bestLockMs: 0,
  },
};

const palette = ["#33ddff", "#c7ff62", "#ff5d68", "#ffd166", "#b892ff"];

function currentDurationMs() {
  return Number(durationSelect.value) * 1000;
}

function currentRadius() {
  return Number(sizeRange.value);
}

function currentSpeed() {
  return Number(speedRange.value);
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  state.dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  state.width = Math.max(320, rect.width);
  state.height = Math.max(240, rect.height);
  canvas.width = Math.floor(state.width * state.dpr);
  canvas.height = Math.floor(state.height * state.dpr);
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  keepTargetsInBounds();
  render();
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function createTarget(index = 0, moving = false) {
  const radius = currentRadius() + (state.mode === "track" ? 8 : 0);
  const margin = radius + 18;
  const speed = (currentSpeed() * 48 + 80) / 1000;
  const angle = randomBetween(0, Math.PI * 2);

  return {
    x: randomBetween(margin, Math.max(margin, state.width - margin)),
    y: randomBetween(margin, Math.max(margin, state.height - margin)),
    r: radius,
    color: palette[index % palette.length],
    createdAt: performance.now(),
    lockedOnce: false,
    vx: moving ? Math.cos(angle) * speed : 0,
    vy: moving ? Math.sin(angle) * speed : 0,
  };
}

function resetTargets() {
  if (state.mode === "grid") {
    state.targets = [createTarget(0), createTarget(1), createTarget(2)];
    spreadGridTargets();
    return;
  }

  state.targets = [createTarget(0, state.mode === "track")];
}

function spreadGridTargets() {
  const minGap = currentRadius() * 2.7;

  for (let pass = 0; pass < 18; pass += 1) {
    for (let i = 0; i < state.targets.length; i += 1) {
      for (let j = i + 1; j < state.targets.length; j += 1) {
        const a = state.targets[i];
        const b = state.targets[j];
        if (distance(a.x, a.y, b.x, b.y) < minGap) {
          state.targets[j] = createTarget(j);
        }
      }
    }
  }
}

function keepTargetsInBounds() {
  for (const target of state.targets) {
    target.x = Math.min(Math.max(target.r, target.x), state.width - target.r);
    target.y = Math.min(Math.max(target.r, target.y), state.height - target.r);
  }
}

function startSession() {
  state.running = true;
  state.paused = false;
  state.remainingMs = currentDurationMs();
  state.lastFrame = performance.now();
  state.score = 0;
  state.hits = 0;
  state.shots = 0;
  state.streak = 0;
  state.bestStreak = 0;
  state.reactions = [];
  state.effects = [];
  state.tracking = {
    firingMs: 0,
    lockedMs: 0,
    currentLockMs: 0,
    bestLockMs: 0,
  };
  resultOverlay.classList.add("hidden");
  resetTargets();
  setControlsEnabled(false);
  updateHud();
  updateStatus();
  requestAnimationFrame(loop);
}

function pauseSession() {
  if (!state.running) {
    return;
  }

  state.paused = !state.paused;
  state.lastFrame = performance.now();
  updateStatus();
}

function resetSession() {
  state.running = false;
  state.paused = false;
  state.pointer.down = false;
  state.remainingMs = currentDurationMs();
  state.score = 0;
  state.hits = 0;
  state.shots = 0;
  state.streak = 0;
  state.bestStreak = 0;
  state.reactions = [];
  state.effects = [];
  state.tracking.currentLockMs = 0;
  state.tracking.bestLockMs = 0;
  resultOverlay.classList.add("hidden");
  resetTargets();
  setControlsEnabled(true);
  updateHud();
  updateStatus();
  render();
}

function endSession() {
  state.running = false;
  state.paused = false;
  state.pointer.down = false;
  state.remainingMs = 0;
  setControlsEnabled(true);
  updateHud();
  updateStatus();
  finalScore.textContent = formatNumber(Math.round(state.score));
  finalAccuracy.textContent = formatAccuracy();
  finalReaction.textContent = formatReaction();
  resultOverlay.classList.remove("hidden");
}

function setControlsEnabled(enabled) {
  durationSelect.disabled = !enabled;
  sizeRange.disabled = !enabled;
  speedRange.disabled = !enabled;
  modeButtons.forEach((button) => {
    button.disabled = !enabled;
  });
}

function loop(frameTime) {
  if (!state.running) {
    return;
  }

  const dt = Math.min(80, frameTime - state.lastFrame);
  state.lastFrame = frameTime;

  if (!state.paused) {
    state.remainingMs = Math.max(0, state.remainingMs - dt);
    updateMovingTargets(dt);
    updateTracking(dt, frameTime);
    updateEffects(dt);

    if (state.remainingMs <= 0) {
      endSession();
      render();
      return;
    }
  }

  updateHud();
  render();
  requestAnimationFrame(loop);
}

function updateMovingTargets(dt) {
  if (state.mode !== "track") {
    return;
  }

  for (const target of state.targets) {
    target.x += target.vx * dt;
    target.y += target.vy * dt;

    if (target.x < target.r || target.x > state.width - target.r) {
      target.vx *= -1;
      target.x = Math.min(Math.max(target.r, target.x), state.width - target.r);
    }

    if (target.y < target.r || target.y > state.height - target.r) {
      target.vy *= -1;
      target.y = Math.min(Math.max(target.r, target.y), state.height - target.r);
    }
  }
}

function updateTracking(dt, frameTime) {
  if (state.mode !== "track" || !state.pointer.down || state.paused) {
    state.tracking.currentLockMs = 0;
    return;
  }

  state.tracking.firingMs += dt;
  state.shots = state.tracking.firingMs;

  const target = state.targets[0];
  const locked = target && isInsideTarget(target, state.pointer.x, state.pointer.y);

  if (!locked) {
    state.tracking.currentLockMs = 0;
    return;
  }

  if (!target.lockedOnce) {
    target.lockedOnce = true;
    state.reactions.push(frameTime - target.createdAt);
  }

  state.tracking.lockedMs += dt;
  state.tracking.currentLockMs += dt;
  state.tracking.bestLockMs = Math.max(state.tracking.bestLockMs, state.tracking.currentLockMs);
  state.hits = state.tracking.lockedMs;
  state.bestStreak = Math.floor(state.tracking.bestLockMs / 100);
  state.score += dt * (0.16 + currentSpeed() * 0.012);
}

function updateEffects(dt) {
  state.effects = state.effects
    .map((effect) => ({
      ...effect,
      age: effect.age + dt,
    }))
    .filter((effect) => effect.age < effect.life);
}

function handleArenaPress(event) {
  if (!state.running || state.paused) {
    return;
  }

  updatePointer(event);
  state.pointer.down = true;

  if (state.mode === "track") {
    return;
  }

  state.shots += 1;
  const hitIndex = state.targets.findIndex((target) => isInsideTarget(target, state.pointer.x, state.pointer.y));

  if (hitIndex === -1) {
    state.streak = 0;
    state.score = Math.max(0, state.score - 15);
    addEffect(state.pointer.x, state.pointer.y, "#ff5d68", false);
    updateHud();
    render();
    return;
  }

  registerHit(hitIndex);
  updateHud();
  render();
}

function registerHit(index) {
  const target = state.targets[index];
  const reaction = performance.now() - target.createdAt;
  state.reactions.push(reaction);
  state.hits += 1;
  state.streak += 1;
  state.bestStreak = Math.max(state.bestStreak, state.streak);
  state.score += Math.round(100 + Math.min(120, state.streak * 8) + Math.max(0, 120 - reaction / 3));
  addEffect(target.x, target.y, target.color, true);

  if (state.mode === "grid") {
    state.targets[index] = createTarget(index);
    spreadGridTargets();
  } else {
    state.targets = [createTarget(0)];
  }
}

function addEffect(x, y, color, hit) {
  state.effects.push({
    x,
    y,
    color,
    hit,
    age: 0,
    life: hit ? 420 : 300,
  });
}

function updatePointer(event) {
  const rect = canvas.getBoundingClientRect();
  state.pointer.x = event.clientX - rect.left;
  state.pointer.y = event.clientY - rect.top;
  state.pointer.inside =
    state.pointer.x >= 0 &&
    state.pointer.y >= 0 &&
    state.pointer.x <= rect.width &&
    state.pointer.y <= rect.height;
}

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function isInsideTarget(target, x, y) {
  return distance(target.x, target.y, x, y) <= target.r;
}

function drawBackground() {
  ctx.clearRect(0, 0, state.width, state.height);

  const gridSize = 42;
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = "#5a5647";
  ctx.lineWidth = 1;

  for (let x = 0; x <= state.width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, state.height);
    ctx.stroke();
  }

  for (let y = 0; y <= state.height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(state.width, y);
    ctx.stroke();
  }

  ctx.restore();

  const gradient = ctx.createRadialGradient(
    state.width * 0.5,
    state.height * 0.48,
    20,
    state.width * 0.5,
    state.height * 0.48,
    Math.max(state.width, state.height) * 0.74,
  );
  gradient.addColorStop(0, "rgba(255,255,255,0.04)");
  gradient.addColorStop(1, "rgba(0,0,0,0.34)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.width, state.height);
}

function drawTarget(target, index) {
  const pulse = state.running ? Math.sin(performance.now() / 120 + index) * 2 : 0;
  const radius = target.r + pulse;

  ctx.save();
  ctx.shadowColor = target.color;
  ctx.shadowBlur = 24;
  ctx.fillStyle = target.color;
  ctx.beginPath();
  ctx.arc(target.x, target.y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(17, 17, 15, 0.82)";
  ctx.lineWidth = Math.max(4, radius * 0.14);
  ctx.beginPath();
  ctx.arc(target.x, target.y, radius * 0.62, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(245, 242, 232, 0.88)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(target.x - radius * 0.36, target.y);
  ctx.lineTo(target.x + radius * 0.36, target.y);
  ctx.moveTo(target.x, target.y - radius * 0.36);
  ctx.lineTo(target.x, target.y + radius * 0.36);
  ctx.stroke();
  ctx.restore();
}

function drawEffects() {
  for (const effect of state.effects) {
    const progress = effect.age / effect.life;
    const radius = effect.hit ? 22 + progress * 44 : 12 + progress * 28;

    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.strokeStyle = effect.color;
    ctx.lineWidth = effect.hit ? 4 : 2;
    ctx.beginPath();
    ctx.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
    ctx.stroke();

    if (effect.hit) {
      ctx.fillStyle = effect.color;
      ctx.globalAlpha = (1 - progress) * 0.3;
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, radius * 0.38, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

function drawPointer() {
  if (!state.pointer.inside) {
    return;
  }

  const size = state.mode === "track" && state.pointer.down ? 14 : 10;
  ctx.save();
  ctx.strokeStyle = state.pointer.down ? "#c7ff62" : "rgba(245, 242, 232, 0.76)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(state.pointer.x - size, state.pointer.y);
  ctx.lineTo(state.pointer.x - 3, state.pointer.y);
  ctx.moveTo(state.pointer.x + 3, state.pointer.y);
  ctx.lineTo(state.pointer.x + size, state.pointer.y);
  ctx.moveTo(state.pointer.x, state.pointer.y - size);
  ctx.lineTo(state.pointer.x, state.pointer.y - 3);
  ctx.moveTo(state.pointer.x, state.pointer.y + 3);
  ctx.lineTo(state.pointer.x, state.pointer.y + size);
  ctx.stroke();
  ctx.restore();
}

function drawIdleState() {
  if (state.running) {
    return;
  }

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(245, 242, 232, 0.84)";
  ctx.font = "900 52px Inter, system-ui, sans-serif";
  ctx.fillText("READY", state.width / 2, state.height / 2 - 22);
  ctx.fillStyle = "rgba(170, 164, 147, 0.72)";
  ctx.font = "800 15px Inter, system-ui, sans-serif";
  ctx.fillText(`${state.mode.toUpperCase()} · ${currentDurationMs() / 1000}s`, state.width / 2, state.height / 2 + 26);
  ctx.restore();
}

function render() {
  drawBackground();
  state.targets.forEach(drawTarget);
  drawEffects();
  drawPointer();
  drawIdleState();
}

function updateHud() {
  scoreValue.textContent = formatNumber(Math.round(state.score));
  accuracyValue.textContent = formatAccuracy();
  reactionValue.textContent = formatReaction();
  streakValue.textContent = state.mode === "track" ? String(Math.floor(state.tracking.bestLockMs / 100)) : String(state.bestStreak);
  timerValue.textContent = (state.remainingMs / 1000).toFixed(1);
}

function updateStatus() {
  statusDot.classList.toggle("live", state.running && !state.paused);
  statusDot.classList.toggle("paused", state.running && state.paused);
  statusText.textContent = state.running ? (state.paused ? "일시정지" : "진행 중") : "준비";
  startButton.textContent = state.running ? (state.paused ? "재개" : "일시정지") : "시작";
}

function formatAccuracy() {
  if (state.shots <= 0) {
    return "0%";
  }

  return `${Math.round((state.hits / state.shots) * 100)}%`;
}

function formatReaction() {
  if (state.reactions.length === 0) {
    return "0ms";
  }

  const total = state.reactions.reduce((sum, value) => sum + value, 0);
  return `${Math.round(total / state.reactions.length)}ms`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    modeButtons.forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });
    resetSession();
  });
});

startButton.addEventListener("click", () => {
  if (!state.running) {
    startSession();
    return;
  }

  pauseSession();
});

resetButton.addEventListener("click", resetSession);
againButton.addEventListener("click", startSession);

durationSelect.addEventListener("change", resetSession);
sizeRange.addEventListener("input", resetSession);
speedRange.addEventListener("input", resetSession);

canvas.addEventListener("pointerdown", handleArenaPress);
canvas.addEventListener("pointermove", (event) => {
  updatePointer(event);
});
canvas.addEventListener("pointerup", () => {
  state.pointer.down = false;
});
canvas.addEventListener("pointerleave", () => {
  state.pointer.down = false;
  state.pointer.inside = false;
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    if (state.running) {
      pauseSession();
    } else {
      startSession();
    }
  }
});

new ResizeObserver(resizeCanvas).observe(canvas);
resetSession();
