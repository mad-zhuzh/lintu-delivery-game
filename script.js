const DISTANCE_SECONDS = 38; // Короче дистанция, игра проходит быстрее
const MAX_LIVES = 3;
const DRONE_TOP_PADDING = 24;
const DRONE_BOTTOM_PADDING = 36;
const DRONE_BASE_HEIGHT_RATIO = 0.8;
const WORLD_SPEED_START = 118;
const WORLD_SPEED_END = 216;
const WIN_SCREEN_DELAY_MS = 1000;
const DRONE_HIT_INSET = 11;
const HIT_FLASH_MS = 900;

const OBSTACLE_TYPES = ["bird", "cloud", "balloon"];
const OBSTACLE_SVG = {
  bird: '<svg class="obs-svg" viewBox="0 0 52 32" aria-hidden="true" focusable="false"><use href="#sym-bird"/></svg>',
  cloud: '<svg class="obs-svg" viewBox="0 0 60 34" aria-hidden="true" focusable="false"><use href="#sym-cloud"/></svg>',
  balloon: '<svg class="obs-svg" viewBox="0 0 46 46" aria-hidden="true" focusable="false"><use href="#sym-balloon"/></svg>'
};

const startScreen = document.getElementById("start-screen");
const gameScreen = document.getElementById("game-screen");
const winScreen = document.getElementById("win-screen");
const loseScreen = document.getElementById("lose-screen");

const startBtn = document.getElementById("start-btn");
const playAgainBtn = document.getElementById("play-again-btn");
const retryBtn = document.getElementById("retry-btn");

const gameArea = document.getElementById("game-area");
const droneEl = document.getElementById("drone");
const livesEl = document.getElementById("lives");
const messageEl = document.getElementById("message");
const progressFillEl = document.getElementById("progress-fill");
const progressPercentEl = document.getElementById("progress-percent");
const confettiLayer = document.getElementById("confetti-layer");
const deliveryMarkerEl = document.createElement("div");
deliveryMarkerEl.className = "delivery-marker";
deliveryMarkerEl.innerHTML = '<span class="marker-pin"></span>';
gameArea.appendChild(deliveryMarkerEl);

const state = {
  running: false,
  progress: 0,
  lives: MAX_LIVES,
  worldSpeed: WORLD_SPEED_START,
  droneX: 0,
  droneY: 0,
  droneTargetX: 0,
  keys: { left: false, right: false },
  obstacles: [],
  spawnStats: createEmptyStats(),
  totalSpawns: 0,
  spawnAccumulator: 0,
  lastFrame: 0,
  invulnerableUntil: 0,
  markerRect: null,
  touchDragActive: false,
  touchPointerId: null,
  winDelayTimeoutId: null,
  winning: false
};

function createEmptyStats() {
  return OBSTACLE_TYPES.reduce((acc, type) => {
    acc[type] = 0;
    return acc;
  }, {});
}

function showScreen(target) {
  [startScreen, gameScreen, winScreen, loseScreen].forEach((screen) => {
    screen.classList.toggle("active", screen === target);
  });
}

function resetGameState() {
  state.running = false;
  state.progress = 0;
  state.lives = MAX_LIVES;
  state.worldSpeed = WORLD_SPEED_START;
  state.spawnAccumulator = 0;
  state.spawnStats = createEmptyStats();
  state.totalSpawns = 0;
  state.lastFrame = 0;
  state.invulnerableUntil = 0;
  state.markerRect = null;
  state.touchDragActive = false;
  state.touchPointerId = null;
  state.winning = false;
  if (state.winDelayTimeoutId) {
    clearTimeout(state.winDelayTimeoutId);
    state.winDelayTimeoutId = null;
  }

  state.obstacles.forEach((obs) => obs.el.remove());
  state.obstacles = [];
  deliveryMarkerEl.classList.remove("visible");

  const areaRect = gameArea.getBoundingClientRect();
  state.droneX = areaRect.width / 2 - 23;
  state.droneY = getDroneBaseY(areaRect.height);
  state.droneTargetX = state.droneX;

  updateUI();
  renderDrone();
}

function getDroneBaseY(areaHeight) {
  // Дрон всегда зафиксирован в нижней части поля (без свободного движения по вертикали).
  const targetY = areaHeight * DRONE_BASE_HEIGHT_RATIO - droneEl.offsetHeight / 2;
  const maxY = areaHeight - droneEl.offsetHeight - DRONE_BOTTOM_PADDING;
  return Math.max(DRONE_TOP_PADDING, Math.min(maxY, targetY));
}

function updateUI() {
  livesEl.textContent = "❤️".repeat(state.lives) + "🖤".repeat(MAX_LIVES - state.lives);
  const percent = Math.min(100, state.progress * 100);
  progressFillEl.style.width = `${percent}%`;
  progressPercentEl.textContent = `${Math.round(percent)}%`;
}

function startGame() {
  showScreen(gameScreen);
  resetGameState();
  messageEl.textContent = "Летим к клиенту...";
  state.running = true;
  requestAnimationFrame(gameLoop);
}

function getDifficultyMultiplier() {
  // На третьей попытке игра максимально упрощается:
  // ниже скорость и меньше препятствий.
  if (state.lives === 1) {
    return 0.65;
  }
  return 1;
}

function renderDrone() {
  const rect = gameArea.getBoundingClientRect();
  const maxX = rect.width - droneEl.offsetWidth;
  state.droneX = Math.max(0, Math.min(maxX, state.droneX));
  droneEl.style.transform = `translate(${state.droneX}px, ${state.droneY}px)`;
}

function spawnObstacle() {
  const areaRect = gameArea.getBoundingClientRect();
  const progressFactor = Math.min(1, state.progress);
  const easyMode = getDifficultyMultiplier();

  const weights = {
    bird: 0.48,
    cloud: 0.26,
    balloon: 0.26
  };

  let type;
  if (state.totalSpawns >= 6) {
    const missingType = Object.entries(state.spawnStats).find(([, count]) => count === 0);
    if (missingType) {
      type = missingType[0];
    }
  }

  if (!type) {
    const roll = Math.random();
    const birdLimit = weights.bird;
    const cloudLimit = birdLimit + weights.cloud;
    if (roll < birdLimit) {
      type = "bird";
    } else if (roll < cloudLimit) {
      type = "cloud";
    } else {
      type = "balloon";
    }
  }

  const obstacle = document.createElement("div");
  obstacle.classList.add("obstacle", type);
  obstacle.innerHTML = OBSTACLE_SVG[type];

  let width = 28;
  let height = 18;
  let x = 0;
  const localSpeedFactor = 0.94 + progressFactor * 0.18;
  let speed = state.worldSpeed * localSpeedFactor * easyMode;
  let hitInsetX = 4;
  let hitInsetY = 4;
  let hitShiftY = 0;

  if (type === "bird") {
    width = 52;
    height = 32;
    x = 20 + Math.random() * (areaRect.width - width - 40);
    hitInsetX = 10;
    hitInsetY = 8;
  } else if (type === "cloud") {
    width = 60;
    height = 34;
    x = 8 + Math.random() * (areaRect.width - width - 16);
    speed *= 0.88;
    hitInsetX = 12;
    hitInsetY = 12;
    // Хитбокс — нижне-средняя часть силуэта (где плотная заливка).
    hitShiftY = 5;
  } else if (type === "balloon") {
    width = 46;
    height = 46;
    x = 10 + Math.random() * (areaRect.width - width - 20);
    speed *= 0.8;
    // Уменьшенный хитбокс шара: столкновение только по центральной части.
    hitInsetX = 15;
    hitInsetY = 15;
    hitShiftY = 6;
  }

  obstacle.style.left = `${x}px`;
  // Держим базовую координату top = 0, чтобы визуальная позиция и хитбокс совпадали.
  obstacle.style.top = "0px";
  gameArea.appendChild(obstacle);

  state.obstacles.push({
    el: obstacle,
    type,
    x,
    y: -height - 10,
    width,
    height,
    speed,
    hitInsetX,
    hitInsetY,
    hitShiftY
  });
  state.spawnStats[type] += 1;
  state.totalSpawns += 1;
}

function updateObstacles(deltaSec) {
  const areaRect = gameArea.getBoundingClientRect();

  for (let i = state.obstacles.length - 1; i >= 0; i--) {
    const obs = state.obstacles[i];
    obs.y += obs.speed * deltaSec;
    obs.el.style.transform = `translateY(${Math.round(obs.y)}px)`;

    if (obs.y > areaRect.height + 120) {
      obs.el.remove();
      state.obstacles.splice(i, 1);
    }
  }
}

function updateDeliveryMarker() {
  const areaRect = gameArea.getBoundingClientRect();
  const markerWidth = 55;
  const markerHeight = 81;
  const progressStart = 0.85;
  if (state.progress < progressStart) {
    deliveryMarkerEl.classList.remove("visible");
    state.markerRect = null;
    return;
  }

  deliveryMarkerEl.classList.add("visible");
  const localProgress = Math.min(1, (state.progress - progressStart) / (1 - progressStart));
  const x = areaRect.width * 0.5 - markerWidth / 2;
  // Чем ближе к финишу, тем ближе маркер к дрону.
  const targetY = state.droneY - 6;
  const y = -markerHeight + localProgress * (targetY + markerHeight);
  deliveryMarkerEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  state.markerRect = { x, y, width: markerWidth, height: markerHeight };
}

function getDroneRect() {
  const w = droneEl.offsetWidth;
  const h = droneEl.offsetHeight;
  return {
    x: state.droneX + DRONE_HIT_INSET,
    y: state.droneY + DRONE_HIT_INSET,
    width: Math.max(10, w - DRONE_HIT_INSET * 2),
    height: Math.max(10, h - DRONE_HIT_INSET * 2)
  };
}

function checkDeliveryReached() {
  if (!state.markerRect) return false;
  // Триггер только когда маркер уже почти полностью доспустился —
  // иначе создаётся ощущение, что маркер сам «падает» на дрон.
  const markerFinalY = state.droneY - 6;
  if (state.markerRect.y < markerFinalY - 14) return false;

  const droneRect = getDroneRect();
  // Узкий хитбокс точно по штырю — дрон должен оказаться прямо под маркером.
  const hitWidth = 18;
  const markerHitRect = {
    x: state.markerRect.x + state.markerRect.width / 2 - hitWidth / 2,
    y: state.markerRect.y + 6,
    width: hitWidth,
    height: state.markerRect.height - 14
  };
  return intersects(droneRect, markerHitRect);
}

function intersects(a, b) {
  return a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;
}

function checkCollisions(nowMs) {
  if (nowMs < state.invulnerableUntil) return;

  const droneRect = getDroneRect();

  for (const obs of state.obstacles) {
    const obsRect = {
      x: obs.x + obs.hitInsetX,
      y: obs.y + obs.hitInsetY + (obs.hitShiftY || 0),
      width: Math.max(10, obs.width - obs.hitInsetX * 2),
      height: Math.max(8, obs.height - obs.hitInsetY * 2)
    };

    if (intersects(droneRect, obsRect)) {
      state.lives -= 1;
      updateUI();
      state.invulnerableUntil = nowMs + 1200;
      triggerHitFx();

      if (state.lives <= 0) {
        endGame(false);
      } else if (state.lives === 1) {
        messageEl.textContent = "Последняя попытка!";
      } else {
        messageEl.textContent = "Столкновение! Осторожнее...";
      }
      return;
    }
  }
}

function triggerHitFx() {
  gameArea.classList.remove("hit");
  // Форсируем рестарт анимации тряски/вспышки.
  void gameArea.offsetWidth;
  gameArea.classList.add("hit");
  setTimeout(() => gameArea.classList.remove("hit"), 240);

  droneEl.classList.remove("hit-flash");
  void droneEl.offsetWidth;
  droneEl.classList.add("hit-flash");
  setTimeout(() => droneEl.classList.remove("hit-flash"), HIT_FLASH_MS);
}

function updateDrone(deltaSec) {
  const areaRect = gameArea.getBoundingClientRect();
  const maxX = areaRect.width - droneEl.offsetWidth;
  const keyboardSpeed = 220;

  // На фазе «долёт к маркеру» ввод заблокирован, дрон сам приходит в цель.
  if (!state.winning) {
    if (state.keys.left) state.droneTargetX -= keyboardSpeed * deltaSec;
    if (state.keys.right) state.droneTargetX += keyboardSpeed * deltaSec;
  }

  state.droneTargetX = Math.max(0, Math.min(maxX, state.droneTargetX));

  // Плавное движение к целевой позиции (клик/тач + клавиши).
  const lerp = 0.22;
  state.droneX += (state.droneTargetX - state.droneX) * lerp;
  renderDrone();
}

function emitConfetti() {
  confettiLayer.innerHTML = "";
  const colors = ["#0b64f4", "#ff851a", "#ffd166", "#59a6ff", "#ffb066"];

  for (let i = 0; i < 65; i++) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = `${Math.random() * 0.7}s`;
    piece.style.transform = `translateY(-24px) rotate(${Math.random() * 180}deg)`;
    confettiLayer.appendChild(piece);
  }
}

function endGame(isWin) {
  state.running = false;
  if (state.winDelayTimeoutId) {
    clearTimeout(state.winDelayTimeoutId);
    state.winDelayTimeoutId = null;
  }
  state.obstacles.forEach((obs) => obs.el.remove());
  state.obstacles = [];
  deliveryMarkerEl.classList.remove("visible");

  if (isWin) {
    emitConfetti();
    showScreen(winScreen);
  } else {
    showScreen(loseScreen);
  }
}

function triggerWinSequence() {
  if (state.winning) return;
  state.winning = true;
  messageEl.textContent = "Доставлено!";

  // Аккуратно «прицеливаем» дрон точно под маркер — существующий lerp
  // за несколько кадров доведёт его в нужную точку, пока маркер
  // доспускается на свою финальную позицию.
  if (state.markerRect) {
    const targetCenter = state.markerRect.x + state.markerRect.width / 2;
    state.droneTargetX = targetCenter - droneEl.offsetWidth / 2;
  }

  state.winDelayTimeoutId = setTimeout(() => {
    state.winDelayTimeoutId = null;
    endGame(true);
  }, WIN_SCREEN_DELAY_MS);
}

function gameLoop(timestamp) {
  if (!state.running) return;

  if (!state.lastFrame) state.lastFrame = timestamp;
  const deltaSec = Math.min(0.033, (timestamp - state.lastFrame) / 1000);
  state.lastFrame = timestamp;

  // Режим «дрон долетает к маркеру»: маркер уже почти на финальной позиции
  // (см. checkDeliveryReached), поэтому фиксируем мир и движем только дрон —
  // ощущение, что это дрон долетает к маркеру, а не наоборот.
  if (state.winning) {
    updateDrone(deltaSec);
    updateObstacles(deltaSec);
    requestAnimationFrame(gameLoop);
    return;
  }

  const easyMode = getDifficultyMultiplier();

  state.progress += deltaSec / DISTANCE_SECONDS;
  state.progress = Math.min(1, state.progress);
  updateUI();

  // Плавный рост сложности: в начале мягко, к финишу заметно плотнее.
  const progressFactor = state.progress;
  const easedProgress = progressFactor * progressFactor * (3 - 2 * progressFactor);
  const spawnPerSecond = (0.72 + easedProgress * 1.78) * easyMode;
  state.spawnAccumulator += deltaSec * spawnPerSecond;
  while (state.spawnAccumulator >= 1) {
    spawnObstacle();
    state.spawnAccumulator -= 1;
  }

  state.worldSpeed = (WORLD_SPEED_START + (WORLD_SPEED_END - WORLD_SPEED_START) * easedProgress) * easyMode;

  updateDrone(deltaSec);
  updateObstacles(deltaSec);
  updateDeliveryMarker();
  if (checkDeliveryReached()) {
    triggerWinSequence();
    requestAnimationFrame(gameLoop);
    return;
  }
  checkCollisions(timestamp);

  requestAnimationFrame(gameLoop);
}

function pointerMoveHandler(clientX) {
  const rect = gameArea.getBoundingClientRect();
  const targetX = clientX - rect.left - droneEl.offsetWidth / 2;
  const maxX = rect.width - droneEl.offsetWidth;
  state.droneTargetX = Math.max(0, Math.min(maxX, targetX));
}

startBtn.addEventListener("click", startGame);
playAgainBtn.addEventListener("click", startGame);
retryBtn.addEventListener("click", startGame);

window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") state.keys.left = true;
  if (event.key === "ArrowRight") state.keys.right = true;
});

window.addEventListener("keyup", (event) => {
  if (event.key === "ArrowLeft") state.keys.left = false;
  if (event.key === "ArrowRight") state.keys.right = false;
});

gameArea.addEventListener("click", (event) => {
  if (!state.running || state.winning) return;
  pointerMoveHandler(event.clientX);
});

gameArea.addEventListener("pointerdown", (event) => {
  if (!state.running || state.winning) return;
  if (event.pointerType === "touch") {
    state.touchDragActive = true;
    state.touchPointerId = event.pointerId;
    return;
  }
  pointerMoveHandler(event.clientX);
});

gameArea.addEventListener("pointermove", (event) => {
  if (!state.running || state.winning) return;
  if (
    event.pointerType === "touch" &&
    state.touchDragActive &&
    event.pointerId === state.touchPointerId
  ) {
    pointerMoveHandler(event.clientX);
  }
});

gameArea.addEventListener("pointerup", (event) => {
  if (event.pointerType !== "touch") return;
  if (event.pointerId !== state.touchPointerId) return;
  state.touchDragActive = false;
  state.touchPointerId = null;
});

gameArea.addEventListener("pointercancel", (event) => {
  if (event.pointerType !== "touch") return;
  if (event.pointerId !== state.touchPointerId) return;
  state.touchDragActive = false;
  state.touchPointerId = null;
});

window.addEventListener("resize", () => {
  if (!gameScreen.classList.contains("active")) return;
  const areaRect = gameArea.getBoundingClientRect();
  state.droneY = getDroneBaseY(areaRect.height);
  renderDrone();
});

showScreen(startScreen);
