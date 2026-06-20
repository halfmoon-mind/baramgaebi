const MODES = {
  precision: {
    title: "정밀 조준",
    label: "정밀",
    targetCount: 1,
    radiusMax: 34,
    radiusMin: 15,
    life: 0,
    color: "#4ee6a8",
    baseScore: 110,
  },
  burst: {
    title: "스피드 샷",
    label: "스피드",
    targetCount: 4,
    radiusMax: 31,
    radiusMin: 13,
    life: 0,
    color: "#67d7ff",
    baseScore: 82,
  },
  reflex: {
    title: "반응 테스트",
    label: "반응",
    targetCount: 1,
    radiusMax: 36,
    radiusMin: 18,
    life: 1250,
    color: "#ff6a4d",
    baseScore: 120,
  },
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const ui = {
  canvas: $("#aimCanvas"),
  arena: $("#arena"),
  overlay: $("#screenOverlay"),
  overlayTitle: $("#overlayTitle"),
  overlayStart: $("#overlayStart"),
  startBtn: $("#startBtn"),
  resetBtn: $("#resetBtn"),
  difficulty: $("#difficulty"),
  difficultyValue: $("#difficultyValue"),
  modePill: $("#modePill"),
  statePill: $("#statePill"),
  arenaTitle: $("#arenaTitle"),
  timeValue: $("#timeValue"),
  timerFill: $("#timerFill"),
  scoreValue: $("#scoreValue"),
  accuracyValue: $("#accuracyValue"),
  hitsValue: $("#hitsValue"),
  missesValue: $("#missesValue"),
  streakValue: $("#streakValue"),
  bestStreakValue: $("#bestStreakValue"),
  reactionValue: $("#reactionValue"),
  resultScore: $("#resultScore"),
  resultAccuracy: $("#resultAccuracy"),
  resultReaction: $("#resultReaction"),
  reactionBars: $("#reactionBars"),
  paceValue: $("#paceValue"),
};

const ctx = ui.canvas.getContext("2d");

const state = {
  mode: "precision",
  duration: 45,
  running: false,
  score: 0,
  hits: 0,
  misses: 0,
  streak: 0,
  bestStreak: 0,
  reactions: [],
  targets: [],
  particles: [],
  mouse: { x: 0, y: 0, active: false },
  startedAt: 0,
  endAt: 0,
  lastFrameAt: 0,
  raf: 0,
  width: 0,
  height: 0,
};

function difficulty() {
  return Number(ui.difficulty.value);
}

function targetRadius() {
  const mode = MODES[state.mode];
  const ratio = (difficulty() - 1) / 9;
  return Math.round(mode.radiusMax - (mode.radiusMax - mode.radiusMin) * ratio);
}

function targetLife() {
  const base = MODES[state.mode].life;
  if (!base) return 0;
  return Math.max(620, base - difficulty() * 58);
}

function targetCount() {
  if (state.mode !== "burst") return MODES[state.mode].targetCount;
  return MODES.burst.targetCount + Math.floor(difficulty() / 3);
}

function resizeCanvas() {
  const rect = ui.arena.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  state.width = Math.floor(rect.width);
  state.height = Math.floor(rect.height);
  ui.canvas.width = Math.floor(rect.width * dpr);
  ui.canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw(performance.now());
}

function randomTarget() {
  const radius = targetRadius();
  const padding = radius + 28;
  let x = padding;
  let y = padding;

  for (let attempt = 0; attempt < 80; attempt += 1) {
    x = randomBetween(padding, state.width - padding);
    y = randomBetween(padding, state.height - padding);
    const overlaps = state.targets.some((target) => {
      return distance(x, y, target.x, target.y) < radius + target.r + 34;
    });

    if (!overlaps) break;
  }

  return {
    x,
    y,
    r: radius,
    createdAt: performance.now(),
    life: targetLife(),
    color: MODES[state.mode].color,
  };
}

function ensureTargets() {
  while (state.targets.length < targetCount()) {
    state.targets.push(randomTarget());
  }
}

function startGame() {
  resetStats();
  state.running = true;
  state.startedAt = performance.now();
  state.endAt = state.startedAt + state.duration * 1000;
  state.lastFrameAt = state.startedAt;
  ui.overlay.classList.add("is-hidden");
  ui.statePill.textContent = "진행";
  ui.statePill.classList.add("status-pill--live");
  ensureTargets();
  cancelAnimationFrame(state.raf);
  state.raf = requestAnimationFrame(loop);
}

function endGame() {
  state.running = false;
  state.targets = [];
  ui.overlay.classList.remove("is-hidden");
  ui.overlayTitle.textContent = "결과";
  ui.overlayStart.textContent = "다시 시작";
  ui.statePill.textContent = "완료";
  ui.statePill.classList.remove("status-pill--live");
  updateStats();
  draw(performance.now());
}

function resetGame() {
  cancelAnimationFrame(state.raf);
  resetStats();
  state.running = false;
  state.targets = [];
  state.particles = [];
  ui.overlay.classList.remove("is-hidden");
  ui.overlayTitle.textContent = "에임 테스트";
  ui.overlayStart.textContent = "시작";
  ui.statePill.textContent = "대기";
  ui.statePill.classList.add("status-pill--live");
  updateStats();
  draw(performance.now());
}

function resetStats() {
  state.score = 0;
  state.hits = 0;
  state.misses = 0;
  state.streak = 0;
  state.bestStreak = 0;
  state.reactions = [];
  state.targets = [];
  state.particles = [];
}

function loop(now) {
  const remaining = state.endAt - now;
  const dt = Math.min(40, now - state.lastFrameAt);
  state.lastFrameAt = now;

  if (remaining <= 0) {
    endGame();
    return;
  }

  expireTargets(now);
  updateParticles(dt);
  ensureTargets();
  updateStats(now);
  draw(now);
  state.raf = requestAnimationFrame(loop);
}

function expireTargets(now) {
  const keptTargets = [];

  for (const target of state.targets) {
    const expired = target.life && now - target.createdAt > target.life;
    if (expired) {
      state.misses += 1;
      state.streak = 0;
      addMissPulse(target.x, target.y);
    } else {
      keptTargets.push(target);
    }
  }

  state.targets = keptTargets;
}

function updateParticles(dt) {
  const step = dt / 16.67;
  state.particles = state.particles
    .map((particle) => ({
      ...particle,
      x: particle.x + particle.vx * step,
      y: particle.y + particle.vy * step,
      life: particle.life - 0.035 * step,
    }))
    .filter((particle) => particle.life > 0);
}

function handleShot(event) {
  if (!state.running) return;

  const point = canvasPoint(event);
  state.mouse.x = point.x;
  state.mouse.y = point.y;
  state.mouse.active = true;

  const hitIndex = state.targets.findIndex((target) => {
    return distance(point.x, point.y, target.x, target.y) <= target.r;
  });

  if (hitIndex === -1) {
    state.misses += 1;
    state.streak = 0;
    state.score = Math.max(0, state.score - 6);
    addMissPulse(point.x, point.y);
    updateStats();
    return;
  }

  const target = state.targets[hitIndex];
  const reaction = performance.now() - target.createdAt;
  state.targets.splice(hitIndex, 1);
  state.hits += 1;
  state.streak += 1;
  state.bestStreak = Math.max(state.bestStreak, state.streak);
  state.reactions.push(reaction);
  state.score += scoreForHit(reaction);
  addHitParticles(target);
  ensureTargets();
  updateStats();
}

function scoreForHit(reaction) {
  const mode = MODES[state.mode];
  const speedBonus = Math.max(0, Math.round(96 - reaction / 9));
  const streakBonus = Math.min(90, state.streak * 6);
  const difficultyBonus = difficulty() * 4;
  return mode.baseScore + speedBonus + streakBonus + difficultyBonus;
}

function addHitParticles(target) {
  for (let i = 0; i < 14; i += 1) {
    const angle = (Math.PI * 2 * i) / 14;
    const speed = randomBetween(2.4, 6.2);
    state.particles.push({
      x: target.x,
      y: target.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      color: target.color,
      size: randomBetween(2, 5),
    });
  }
}

function addMissPulse(x, y) {
  state.particles.push({
    x,
    y,
    vx: 0,
    vy: 0,
    life: 0.9,
    color: "#ff6a4d",
    size: 18,
    miss: true,
  });
}

function updateStats(now = performance.now()) {
  const attempts = state.hits + state.misses;
  const accuracy = attempts ? Math.round((state.hits / attempts) * 100) : 0;
  const avgReaction = average(state.reactions);
  const elapsed = state.running ? Math.max(1, (now - state.startedAt) / 1000) : state.duration;
  const pace = Math.round((state.hits / elapsed) * 60);
  const remaining = state.running ? Math.max(0, (state.endAt - now) / 1000) : state.duration;
  const progress = state.running ? remaining / state.duration : 1;

  ui.timeValue.textContent = remaining.toFixed(1);
  ui.timerFill.style.transform = `scaleX(${progress})`;
  ui.scoreValue.textContent = state.score.toLocaleString("ko-KR");
  ui.accuracyValue.textContent = `${accuracy}%`;
  ui.hitsValue.textContent = state.hits;
  ui.missesValue.textContent = state.misses;
  ui.streakValue.textContent = state.streak;
  ui.bestStreakValue.textContent = state.bestStreak;
  ui.reactionValue.textContent = `${Math.round(avgReaction)}ms`;
  ui.resultScore.textContent = state.score.toLocaleString("ko-KR");
  ui.resultAccuracy.textContent = `${accuracy}%`;
  ui.resultReaction.textContent = `${Math.round(avgReaction)}ms`;
  ui.paceValue.textContent = `${pace}/min`;
  renderReactionBars();
}

function renderReactionBars() {
  const recent = state.reactions.slice(-12);
  ui.reactionBars.innerHTML = "";

  for (let i = 0; i < 12; i += 1) {
    const reaction = recent[i] || 0;
    const bar = document.createElement("span");
    const normalized = reaction ? Math.max(0.14, Math.min(1, 1 - reaction / 1200)) : 0.1;
    bar.style.height = `${Math.round(18 + normalized * 86)}px`;
    bar.style.opacity = reaction ? "1" : "0.22";
    ui.reactionBars.appendChild(bar);
  }
}

function draw(now) {
  ctx.clearRect(0, 0, state.width, state.height);
  drawGridMarks();
  state.targets.forEach((target) => drawTarget(target, now));
  state.particles.forEach(drawParticle);
  if (state.mouse.active) drawCrosshair(state.mouse.x, state.mouse.y);
}

function drawGridMarks() {
  ctx.save();
  ctx.strokeStyle = "rgba(244, 247, 242, 0.055)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(state.width / 2, 0);
  ctx.lineTo(state.width / 2, state.height);
  ctx.moveTo(0, state.height / 2);
  ctx.lineTo(state.width, state.height / 2);
  ctx.stroke();
  ctx.restore();
}

function drawTarget(target, now) {
  const pulse = Math.sin(now / 110) * 1.5;

  ctx.save();
  ctx.shadowColor = target.color;
  ctx.shadowBlur = 22;
  ctx.fillStyle = target.color;
  ctx.beginPath();
  ctx.arc(target.x, target.y, target.r + pulse, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.76)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(target.x, target.y, target.r * 0.54, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(17, 19, 19, 0.72)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(target.x - target.r * 0.34, target.y);
  ctx.lineTo(target.x + target.r * 0.34, target.y);
  ctx.moveTo(target.x, target.y - target.r * 0.34);
  ctx.lineTo(target.x, target.y + target.r * 0.34);
  ctx.stroke();

  if (target.life) {
    const lifeLeft = Math.max(0, 1 - (now - target.createdAt) / target.life);
    ctx.strokeStyle = "#ffd166";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(target.x, target.y, target.r + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * lifeLeft);
    ctx.stroke();
  }

  ctx.restore();
}

function drawParticle(particle) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, particle.life);

  if (particle.miss) {
    ctx.strokeStyle = particle.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size * (1.4 - particle.life), 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawCrosshair(x, y) {
  ctx.save();
  ctx.strokeStyle = "rgba(244, 247, 242, 0.92)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - 12, y);
  ctx.lineTo(x - 4, y);
  ctx.moveTo(x + 4, y);
  ctx.lineTo(x + 12, y);
  ctx.moveTo(x, y - 12);
  ctx.lineTo(x, y - 4);
  ctx.moveTo(x, y + 4);
  ctx.lineTo(x, y + 12);
  ctx.stroke();
  ctx.restore();
}

function canvasPoint(event) {
  const rect = ui.canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function setMode(mode) {
  state.mode = mode;
  const modeConfig = MODES[mode];
  ui.modePill.textContent = modeConfig.label;
  ui.arenaTitle.textContent = modeConfig.title;
  $$(".segment").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === mode);
  });
  resetGame();
}

function setDuration(duration) {
  state.duration = Number(duration);
  $$(".chip").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.duration) === state.duration);
  });
  resetGame();
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function randomBetween(min, max) {
  if (max <= min) return min;
  return Math.random() * (max - min) + min;
}

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

ui.canvas.addEventListener("pointerdown", handleShot);
ui.canvas.addEventListener("pointermove", (event) => {
  const point = canvasPoint(event);
  state.mouse.x = point.x;
  state.mouse.y = point.y;
  state.mouse.active = true;
});
ui.canvas.addEventListener("pointerleave", () => {
  state.mouse.active = false;
});

ui.startBtn.addEventListener("click", startGame);
ui.overlayStart.addEventListener("click", startGame);
ui.resetBtn.addEventListener("click", resetGame);

$$(".segment").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

$$(".chip").forEach((button) => {
  button.addEventListener("click", () => setDuration(button.dataset.duration));
});

ui.difficulty.addEventListener("input", () => {
  ui.difficultyValue.textContent = ui.difficulty.value;
  resetGame();
});

window.addEventListener("resize", resizeCanvas);

resizeCanvas();
updateStats();
renderReactionBars();
