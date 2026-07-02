/* =========================================================
   RẮN SĂN MỒI (slither-style) — Tiktok: IT nhiều chuyện
   ========================================================= */

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const mini = document.getElementById("minimap");
const mctx = mini.getContext("2d");

// ----- Config -----
const WORLD_R = 2200;            // bán kính đấu trường
const BASE_MASS = 12;            // độ dài khởi đầu
const MIN_MASS = 8;
const NORMAL_SPEED = 2.6;
const BOOST_SPEED = 4.9;
const MAX_TURN = 0.16;           // rad mỗi frame
const BOT_COUNT = 14;            // số rắn bot trong phòng
const FOOD_TARGET = 550;         // số mồi luôn có trên bản đồ

const BOT_NAMES = [
  "Bé Đẹt", "Tí Anh", "Su Su", "Bin", "Cà Rốt", "Mì Gói", "Bơ", "Kem",
  "Gấu", "Xù", "Mập", "Cu Tí", "Bông", "Nhím", "Còi", "Mèo", "Ki Ki",
  "Đậu", "Bắp", "Tôm", "Cá Mập", "Rồng", "Hổ", "Sói",
];

const COLORS = [
  "#4ade80", "#22d3ee", "#a78bfa", "#f472b6", "#fbbf24",
  "#fb7185", "#34d399", "#60a5fa", "#f59e0b", "#c084fc",
  "#2dd4bf", "#f87171", "#38bdf8", "#e879f9",
];

// ----- State -----
let snakes = [];
let foods = [];
let player = null;
let running = false;
let bestRank = 999;

const mouse = { x: 0, y: 0 };
let boosting = false;

// ----- Canvas sizing -----
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  mouse.x = canvas.width / 2;
  mouse.y = canvas.height / 2 - 100;
}
window.addEventListener("resize", resize);
resize();
mini.width = 150;
mini.height = 150;

// ----- Helpers -----
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

function radiusOf(mass) {
  return 6 + Math.min(mass * 0.09, 20);
}

function angleLerp(a, target, max) {
  let d = target - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (d > max) d = max;
  if (d < -max) d = -max;
  return a + d;
}

// ----- Food -----
function spawnFood(x, y, value, color) {
  if (x === undefined) {
    const a = rand(0, Math.PI * 2);
    const r = Math.sqrt(Math.random()) * (WORLD_R - 30);
    x = Math.cos(a) * r;
    y = Math.sin(a) * r;
  }
  foods.push({
    x, y,
    r: value ? Math.min(4 + value * 0.6, 10) : rand(3, 5),
    value: value || 1,
    color: color || pick(COLORS),
    pulse: rand(0, Math.PI * 2),
  });
}

function fillFood() {
  while (foods.length < FOOD_TARGET) spawnFood();
}

// ----- Snake -----
function createSnake(isBot, name, color) {
  const a = rand(0, Math.PI * 2);
  const r = rand(200, WORLD_R - 400);
  const x = Math.cos(a) * r;
  const y = Math.sin(a) * r;
  const angle = rand(0, Math.PI * 2);
  return {
    isBot,
    name: name || "Bạn",
    color: color || pick(COLORS),
    x, y,
    angle,
    desired: angle,
    mass: BASE_MASS,
    speed: NORMAL_SPEED,
    boosting: false,
    alive: true,
    pts: [{ x, y }],
    body: [],
    // AI
    roamAngle: angle,
    aiTimer: 0,
    aggro: Math.random() < 0.55,
  };
}

function neededCircles(mass) {
  return Math.round(10 + mass * 0.9);
}

// Xây danh sách vòng tròn thân từ vệt di chuyển
function buildBody(s) {
  const r = radiusOf(s.mass);
  const gap = r * 0.55;
  const count = neededCircles(s.mass);
  const body = [{ x: s.pts[0].x, y: s.pts[0].y }];
  let acc = 0;
  let lastIdx = 0;
  for (let i = 1; i < s.pts.length && body.length < count; i++) {
    const dx = s.pts[i].x - s.pts[i - 1].x;
    const dy = s.pts[i].y - s.pts[i - 1].y;
    acc += Math.sqrt(dx * dx + dy * dy);
    if (acc >= gap) {
      acc = 0;
      body.push({ x: s.pts[i].x, y: s.pts[i].y });
      lastIdx = i;
    }
  }
  // cắt bớt vệt thừa cho nhẹ
  if (s.pts.length > lastIdx + 8) s.pts.length = lastIdx + 8;
  s.body = body;
  s.radius = r;
}

// ----- AI cho bot -----
function botThink(s) {
  s.aiTimer--;

  // Tránh mép bản đồ (ưu tiên cao nhất)
  const dCenter = Math.hypot(s.x, s.y);
  if (dCenter > WORLD_R - 260) {
    s.desired = Math.atan2(-s.y, -s.x);
    return;
  }

  const headX = s.x + Math.cos(s.angle) * 60;
  const headY = s.y + Math.sin(s.angle) * 60;

  // Né thân rắn khác ngay trước mặt
  for (const o of snakes) {
    if (o === s || !o.alive) continue;
    for (let i = 0; i < o.body.length; i += 2) {
      const b = o.body[i];
      if (dist2(headX, headY, b.x, b.y) < (o.radius + s.radius + 24) ** 2) {
        s.desired = Math.atan2(s.y - b.y, s.x - b.x);
        return;
      }
    }
  }

  // Rắn hung dữ: cắt đầu con nhỏ hơn ở gần
  if (s.aggro) {
    let prey = null, pd = 520 ** 2;
    for (const o of snakes) {
      if (o === s || !o.alive || o.mass > s.mass * 0.85) continue;
      const d = dist2(s.x, s.y, o.x, o.y);
      if (d < pd) { pd = d; prey = o; }
    }
    if (prey) {
      const ax = prey.x + Math.cos(prey.angle) * 90;
      const ay = prey.y + Math.sin(prey.angle) * 90;
      s.desired = Math.atan2(ay - s.y, ax - s.x);
      return;
    }
  }

  // Tìm mồi gần nhất
  let food = null, fd = 460 ** 2;
  for (const f of foods) {
    const d = dist2(s.x, s.y, f.x, f.y);
    if (d < fd) { fd = d; food = f; }
  }
  if (food) {
    s.desired = Math.atan2(food.y - s.y, food.x - s.x);
    return;
  }

  // Lang thang
  if (s.aiTimer <= 0) {
    s.roamAngle += rand(-1, 1);
    s.aiTimer = Math.floor(rand(40, 110));
  }
  s.desired = s.roamAngle;
}

// ----- Cập nhật 1 rắn -----
function updateSnake(s) {
  if (!s.alive) return;

  if (s.isBot) {
    botThink(s);
    // bot cũng biết tăng tốc đôi lúc khi đuổi mồi
    s.boosting = s.aggro && s.mass > 25 && Math.random() < 0.02 ? true : s.boosting;
    if (Math.random() < 0.05) s.boosting = false;
  } else {
    s.desired = Math.atan2(mouse.y - canvas.height / 2, mouse.x - canvas.width / 2);
    s.boosting = boosting;
  }

  s.angle = angleLerp(s.angle, s.desired, MAX_TURN);

  // Tăng tốc: nhanh hơn nhưng hao độ dài
  let sp = NORMAL_SPEED;
  if (s.boosting && s.mass > MIN_MASS + 2) {
    sp = BOOST_SPEED;
    s.mass -= 0.06;
    if (Math.random() < 0.25) {
      const bx = s.pts[s.pts.length - 1].x;
      const by = s.pts[s.pts.length - 1].y;
      spawnFood(bx + rand(-6, 6), by + rand(-6, 6), 1, s.color);
    }
  }
  s.speed = sp;

  s.x += Math.cos(s.angle) * sp;
  s.y += Math.sin(s.angle) * sp;

  s.pts.unshift({ x: s.x, y: s.y });

  buildBody(s);

  // Ăn mồi
  const rEat = s.radius + 14;
  for (let i = foods.length - 1; i >= 0; i--) {
    const f = foods[i];
    if (dist2(s.x, s.y, f.x, f.y) < rEat * rEat) {
      s.mass += f.value * 0.8;
      foods.splice(i, 1);
    }
  }
}

// ----- Va chạm: đầu đụng thân => chết -----
function checkCollisions() {
  for (const s of snakes) {
    if (!s.alive) continue;

    // Đụng mép bản đồ
    if (Math.hypot(s.x, s.y) > WORLD_R) {
      killSnake(s);
      continue;
    }

    for (const o of snakes) {
      if (o === s || !o.alive) continue;
      const rr = (s.radius * 0.7 + o.radius) ** 2;
      // bỏ qua vài đốt đầu để tránh tự xử lý sai
      for (let i = 0; i < o.body.length; i++) {
        const b = o.body[i];
        if (dist2(s.x, s.y, b.x, b.y) < rr) {
          killSnake(s);
          break;
        }
      }
      if (!s.alive) break;
    }
  }
}

// ----- Rắn chết => rải mồi -----
function killSnake(s) {
  s.alive = false;
  const dropColor = s.color;
  for (let i = 0; i < s.body.length; i += 2) {
    const b = s.body[i];
    spawnFood(
      b.x + rand(-6, 6),
      b.y + rand(-6, 6),
      Math.max(2, Math.round(s.radius * 0.4)),
      dropColor
    );
  }
  if (s === player) {
    endGame();
  }
}

// ----- Duy trì số lượng bot -----
function refillBots() {
  const bots = snakes.filter((s) => s.isBot && s.alive).length;
  for (let i = bots; i < BOT_COUNT; i++) {
    snakes.push(createSnake(true, pick(BOT_NAMES), pick(COLORS)));
  }
  // dọn rắn chết khỏi mảng
  snakes = snakes.filter((s) => s.alive || s === player);
}

// ----- Camera / zoom -----
function zoomLevel() {
  const r = player ? player.radius : 6;
  return Math.max(0.55, Math.min(1, 1.15 - (r - 6) / 90));
}

// ----- Render -----
function draw() {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  if (!player) return;
  const zoom = zoomLevel();
  const camX = player.x, camY = player.y;

  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-camX, -camY);

  // Nền lưới
  drawGrid(camX, camY, zoom, W, H);

  // Viền đấu trường
  ctx.beginPath();
  ctx.arc(0, 0, WORLD_R, 0, Math.PI * 2);
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(255,80,120,0.55)";
  ctx.stroke();

  // Mồi
  const t = performance.now() / 400;
  for (const f of foods) {
    const pr = f.r + Math.sin(t + f.pulse) * 0.8;
    ctx.beginPath();
    ctx.arc(f.x, f.y, pr, 0, Math.PI * 2);
    ctx.fillStyle = f.color;
    ctx.shadowColor = f.color;
    ctx.shadowBlur = 12;
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  // Rắn (vẽ con to trước để mình nổi lên trên)
  const order = snakes.filter((s) => s.alive).sort((a, b) => a.mass - b.mass);
  for (const s of order) drawSnake(s);

  ctx.restore();

  drawMinimap();
  updateHUD();
}

function drawGrid(camX, camY, zoom, W, H) {
  const step = 60;
  const halfW = W / 2 / zoom, halfH = H / 2 / zoom;
  const startX = Math.floor((camX - halfW) / step) * step;
  const endX = camX + halfW;
  const startY = Math.floor((camY - halfH) / step) * step;
  const endY = camY + halfH;
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.beginPath();
  for (let x = startX; x < endX; x += step) {
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
  }
  for (let y = startY; y < endY; y += step) {
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
  }
  ctx.stroke();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + amt, g = ((n >> 8) & 255) + amt, b = (n & 255) + amt;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return `rgb(${r},${g},${b})`;
}

function drawSnake(s) {
  const r = s.radius;
  // Thân: vẽ từ đuôi tới đầu
  for (let i = s.body.length - 1; i >= 0; i--) {
    const b = s.body[i];
    const isEdge = i % 2 === 0;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isEdge ? s.color : shade(s.color, -25);
    ctx.fill();
  }

  // Đầu
  const hx = s.x, hy = s.y;
  ctx.beginPath();
  ctx.arc(hx, hy, r * 1.05, 0, Math.PI * 2);
  ctx.fillStyle = shade(s.color, 20);
  ctx.fill();

  // Mắt
  const ea = s.angle;
  const off = r * 0.5;
  const perp = ea + Math.PI / 2;
  for (const sgn of [-1, 1]) {
    const ex = hx + Math.cos(ea) * off + Math.cos(perp) * sgn * r * 0.45;
    const ey = hy + Math.sin(ea) * off + Math.sin(perp) * sgn * r * 0.45;
    ctx.beginPath();
    ctx.arc(ex, ey, r * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex + Math.cos(ea) * r * 0.12, ey + Math.sin(ea) * r * 0.12, r * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = "#111";
    ctx.fill();
  }

  // Tên
  ctx.font = `600 ${Math.max(11, r * 0.9)}px Segoe UI`;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.textAlign = "center";
  ctx.fillText(s.name, hx, hy - r - 6);
}

function drawMinimap() {
  const size = 150, c = size / 2, scale = c / WORLD_R;
  mctx.clearRect(0, 0, size, size);
  mctx.beginPath();
  mctx.arc(c, c, c - 2, 0, Math.PI * 2);
  mctx.fillStyle = "rgba(0,0,0,0.35)";
  mctx.fill();
  for (const s of snakes) {
    if (!s.alive) continue;
    mctx.beginPath();
    const px = c + s.x * scale, py = c + s.y * scale;
    mctx.arc(px, py, s === player ? 3.5 : 2, 0, Math.PI * 2);
    mctx.fillStyle = s === player ? "#fff" : s.color;
    mctx.fill();
  }
}

// ----- HUD -----
const scoreEl = document.getElementById("score");
const rankEl = document.getElementById("rank");

function updateHUD() {
  if (!player || !player.alive) return;
  scoreEl.textContent = Math.floor(player.mass);
  const alive = snakes.filter((s) => s.alive);
  alive.sort((a, b) => b.mass - a.mass);
  const rank = alive.indexOf(player) + 1;
  rankEl.textContent = `${rank}/${alive.length}`;
  if (rank < bestRank) bestRank = rank;
}

// ----- Vòng lặp game -----
function loop() {
  if (!running) return;
  for (const s of snakes) updateSnake(s);
  checkCollisions();
  refillBots();
  fillFood();
  draw();
  requestAnimationFrame(loop);
}

// ----- Bắt đầu / kết thúc -----
const menu = document.getElementById("menu");
const gameover = document.getElementById("gameover");
const hud = document.getElementById("hud");

function startGame() {
  const name = (document.getElementById("playerName").value || "Bạn").trim().slice(0, 12);
  snakes = [];
  foods = [];
  bestRank = 999;
  player = createSnake(false, name || "Bạn", "#4ade80");
  snakes.push(player);
  for (let i = 0; i < BOT_COUNT; i++) {
    snakes.push(createSnake(true, pick(BOT_NAMES), pick(COLORS)));
  }
  fillFood();

  menu.classList.add("hidden");
  gameover.classList.add("hidden");
  hud.classList.remove("hidden");
  mini.classList.remove("hidden");

  running = true;
  loop();
}

function endGame() {
  running = false;
  setTimeout(() => {
    document.getElementById("finalScore").textContent = Math.floor(player.mass);
    document.getElementById("finalRank").textContent =
      bestRank === 999 ? "-" : "#" + bestRank;
    hud.classList.add("hidden");
    mini.classList.add("hidden");
    gameover.classList.remove("hidden");
  }, 350);
}

// ----- Input -----
document.getElementById("playBtn").addEventListener("click", startGame);
document.getElementById("replayBtn").addEventListener("click", startGame);
document.getElementById("playerName").addEventListener("keydown", (e) => {
  if (e.key === "Enter") startGame();
});

window.addEventListener("mousemove", (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});
window.addEventListener("mousedown", () => (boosting = true));
window.addEventListener("mouseup", () => (boosting = false));
window.addEventListener("keydown", (e) => {
  if (e.code === "Space") boosting = true;
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") boosting = false;
});

// Cảm ứng (mobile)
canvas.addEventListener("touchstart", (e) => {
  boosting = true;
  const t = e.touches[0];
  mouse.x = t.clientX;
  mouse.y = t.clientY;
}, { passive: true });
canvas.addEventListener("touchmove", (e) => {
  const t = e.touches[0];
  mouse.x = t.clientX;
  mouse.y = t.clientY;
}, { passive: true });
canvas.addEventListener("touchend", () => (boosting = false));
