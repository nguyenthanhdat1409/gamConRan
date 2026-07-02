/* =========================================================
   RẮN SĂN MỒI - client (chỉ vẽ + gửi input, server tính toán)
   ========================================================= */

const COLORS = [
  "#4ade80", "#22d3ee", "#a78bfa", "#f472b6", "#fbbf24",
  "#fb7185", "#34d399", "#60a5fa", "#f59e0b", "#c084fc",
  "#2dd4bf", "#f87171", "#38bdf8", "#e879f9",
];

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const mini = document.getElementById("minimap");
const mctx = mini.getContext("2d");

// ----- UI refs -----
const menu = document.getElementById("menu");
const lobby = document.getElementById("lobby");
const gameover = document.getElementById("gameover");
const hud = document.getElementById("hud");
const connEl = document.getElementById("conn");

const scoreEl = document.getElementById("score");
const rankEl = document.getElementById("rank");
const playersEl = document.getElementById("players");

// ----- State -----
let state = "menu"; // menu | lobby | playing | dead
let myId = null;
let worldR = 2200;
let bestRank = 999;
let currentMode = "solo";

const buffer = []; // {t, snap}
const INTERP_DELAY = 110; // ms
let foodStore = []; // [x,y,r,ci,...]
let beastStore = []; // [{x,y,r,a,t}]
let lobbyInfo = { online: 0, playing: 0, bots: 0, names: [] };
const BEAST_EMOJI = ["🦖", "🦕", "🐊"];

const cam = { x: 0, y: 0 };
const mouse = { x: 0, y: 0 };
let boosting = false;

// ----- Canvas -----
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

// ----- Socket -----
const socket = io();

socket.on("connect", () => { connEl.classList.add("hidden"); });
socket.on("disconnect", () => {
  connEl.textContent = "Mất kết nối máy chủ...";
  connEl.classList.remove("hidden");
});
socket.on("connect_error", () => {
  connEl.textContent = "Không kết nối được máy chủ";
  connEl.classList.remove("hidden");
});

socket.on("joined", ({ mode }) => {
  currentMode = mode;
  if (mode === "solo") {
    socket.emit("spawn");
  } else {
    showLobby();
  }
});

socket.on("spawned", ({ id }) => {
  myId = id;
  bestRank = 999;
  startPlaying();
});

socket.on("lobby", (info) => {
  lobbyInfo = info;
  if (state === "lobby") renderLobbyList();
});

socket.on("state", (snap) => {
  worldR = snap.w;
  if (snap.f) foodStore = snap.f;
  if (snap.k) beastStore = snap.k;
  buffer.push({ t: performance.now(), snap });
  while (buffer.length > 12) buffer.shift();
});

socket.on("dead", ({ score }) => {
  if (state !== "playing") return;
  endGame(score);
});

// ----- Flow -----
function getName() {
  return (document.getElementById("playerName").value || "Bạn").trim().slice(0, 12) || "Bạn";
}

document.getElementById("soloBtn").addEventListener("click", () => {
  socket.emit("join", { mode: "solo", name: getName() });
});
document.getElementById("multiBtn").addEventListener("click", () => {
  socket.emit("join", { mode: "public", name: getName() });
});
document.getElementById("enterBtn").addEventListener("click", () => {
  socket.emit("spawn");
});
document.getElementById("backBtn").addEventListener("click", () => {
  socket.emit("leave");
  goMenu();
});
document.getElementById("replayBtn").addEventListener("click", () => {
  gameover.classList.add("hidden");
  socket.emit("spawn");
});
document.getElementById("homeBtn").addEventListener("click", () => {
  socket.emit("leave");
  goMenu();
});
document.getElementById("playerName").addEventListener("keydown", (e) => {
  if (e.key === "Enter") socket.emit("join", { mode: "solo", name: getName() });
});

function goMenu() {
  state = "menu";
  myId = null;
  buffer.length = 0;
  hud.classList.add("hidden");
  mini.classList.add("hidden");
  lobby.classList.add("hidden");
  gameover.classList.add("hidden");
  menu.classList.remove("hidden");
}

function showLobby() {
  state = "lobby";
  menu.classList.add("hidden");
  gameover.classList.add("hidden");
  lobby.classList.remove("hidden");
  renderLobbyList();
}

function renderLobbyList() {
  document.getElementById("onlineCount").textContent = lobbyInfo.online;
  document.getElementById("botCount").textContent = lobbyInfo.bots;
  const list = document.getElementById("playerList");
  list.innerHTML = "";
  if (!lobbyInfo.names || lobbyInfo.names.length === 0) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "Chưa có ai... bạn là người đầu tiên!";
    list.appendChild(e);
    return;
  }
  for (const n of lobbyInfo.names) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span class="dot"></span>${escapeHtml(n)}`;
    list.appendChild(row);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function startPlaying() {
  state = "playing";
  menu.classList.add("hidden");
  lobby.classList.add("hidden");
  gameover.classList.add("hidden");
  hud.classList.remove("hidden");
  mini.classList.remove("hidden");
}

function endGame(score) {
  state = "dead";
  document.getElementById("finalScore").textContent = score;
  document.getElementById("finalRank").textContent =
    bestRank === 999 ? "-" : "#" + bestRank;
  hud.classList.add("hidden");
  mini.classList.add("hidden");
  gameover.classList.remove("hidden");
}

// ----- Gửi input đều đặn -----
setInterval(() => {
  if (state !== "playing") return;
  const a = Math.atan2(mouse.y - canvas.height / 2, mouse.x - canvas.width / 2);
  socket.emit("input", { a, boost: boosting });
}, 50);

// ----- Nội suy snapshot -----
function interpolated() {
  const target = performance.now() - INTERP_DELAY;
  if (buffer.length === 0) return null;
  let a = null, b = null;
  for (let i = 0; i < buffer.length - 1; i++) {
    if (buffer[i].t <= target && buffer[i + 1].t >= target) {
      a = buffer[i]; b = buffer[i + 1]; break;
    }
  }
  if (!a) {
    const last = buffer[buffer.length - 1];
    return snapToMap(last.snap, null, 0);
  }
  const alpha = (target - a.t) / Math.max(1, b.t - a.t);
  return snapToMap(a.snap, b.snap, alpha);
}

// Trả về mảng snake đã nội suy
function snapToMap(sa, sb, alpha) {
  const mapB = {};
  if (sb) for (const s of sb.s) mapB[s.id] = s;
  const out = [];
  for (const s of sa.s) {
    const o = sb ? mapB[s.id] : null;
    if (!o) { out.push(cloneSnake(s)); continue; }
    const n = Math.min(s.b.length, o.b.length);
    const b = new Array(o.b.length);
    for (let i = 0; i < n; i++) b[i] = s.b[i] + (o.b[i] - s.b[i]) * alpha;
    for (let i = n; i < o.b.length; i++) b[i] = o.b[i];
    out.push({
      id: s.id, n: s.n, c: s.c,
      r: s.r + (o.r - s.r) * alpha,
      a: lerpAngle(s.a, o.a, alpha),
      m: o.m,
      b,
    });
  }
  return out;
}
function cloneSnake(s) {
  return { id: s.id, n: s.n, c: s.c, r: s.r, a: s.a, m: s.m, b: s.b.slice() };
}
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ----- Render loop -----
function frame() {
  requestAnimationFrame(frame);
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (state !== "playing" && state !== "lobby" && state !== "dead") return;

  const snakes = interpolated();
  if (!snakes) return;

  // camera theo rắn của mình
  let me = null;
  for (const s of snakes) if (s.id === myId) me = s;
  if (me) { cam.x = me.x = me.b[0]; cam.y = me.y = me.b[1]; }
  else if (snakes.length) {
    // lobby: nhìn quanh giữa bản đồ
    if (state === "lobby") { cam.x = 0; cam.y = 0; }
  }

  const zoom = zoomLevel(me ? me.r : 8);

  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-cam.x, -cam.y);

  drawGrid(zoom, W, H);

  ctx.beginPath();
  ctx.arc(0, 0, worldR, 0, Math.PI * 2);
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(255,80,120,0.55)";
  ctx.stroke();

  drawFood();
  drawBeasts();

  const order = snakes.slice().sort((p, q) => p.m - q.m);
  for (const s of order) drawSnake(s);

  ctx.restore();

  drawMinimap(snakes);
  updateHUD(snakes, me);
}

function zoomLevel(r) {
  return Math.max(0.55, Math.min(1, 1.15 - (r - 6) / 90));
}

function drawGrid(zoom, W, H) {
  const step = 60;
  const halfW = W / 2 / zoom, halfH = H / 2 / zoom;
  const startX = Math.floor((cam.x - halfW) / step) * step;
  const endX = cam.x + halfW;
  const startY = Math.floor((cam.y - halfH) / step) * step;
  const endY = cam.y + halfH;
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.beginPath();
  for (let x = startX; x < endX; x += step) { ctx.moveTo(x, startY); ctx.lineTo(x, endY); }
  for (let y = startY; y < endY; y += step) { ctx.moveTo(startX, y); ctx.lineTo(endX, y); }
  ctx.stroke();
}

function drawFood() {
  const t = performance.now() / 400;
  for (let i = 0; i < foodStore.length; i += 4) {
    const x = foodStore[i], y = foodStore[i + 1], r = foodStore[i + 2];
    const col = COLORS[foodStore[i + 3]] || "#fff";
    const pr = r + Math.sin(t + i) * 0.6;
    ctx.beginPath();
    ctx.arc(x, y, pr, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 10;
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

function drawBeasts() {
  const pulse = 1 + Math.sin(performance.now() / 250) * 0.06;
  for (const b of beastStore) {
    // vòng cảnh báo nguy hiểm
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r + 6, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,60,60,0.55)";
    ctx.lineWidth = 3;
    ctx.stroke();

    // thân quái
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * pulse, 0, Math.PI * 2);
    ctx.fillStyle = "#2f7d32";
    ctx.shadowColor = "rgba(255,60,60,0.6)";
    ctx.shadowBlur = 18;
    ctx.fill();
    ctx.shadowBlur = 0;

    // mặt khủng long (emoji)
    const emoji = BEAST_EMOJI[b.t] || "🦖";
    ctx.font = `${Math.round(b.r * 1.7)}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emoji, b.x, b.y + b.r * 0.05);
    ctx.textBaseline = "alphabetic";

    // nhãn
    ctx.font = `700 ${Math.max(12, b.r * 0.35)}px Segoe UI`;
    ctx.fillStyle = "rgba(255,120,120,0.95)";
    ctx.fillText("NGUY HIỂM", b.x, b.y - b.r - 8);
  }
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
  const r = s.r;
  const nseg = s.b.length / 2;
  for (let i = nseg - 1; i >= 0; i--) {
    const x = s.b[i * 2], y = s.b[i * 2 + 1];
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 === 0 ? s.c : shade(s.c, -25);
    ctx.fill();
  }
  const hx = s.b[0], hy = s.b[1];
  ctx.beginPath();
  ctx.arc(hx, hy, r * 1.05, 0, Math.PI * 2);
  ctx.fillStyle = shade(s.c, 20);
  ctx.fill();

  const ea = s.a, off = r * 0.5, perp = ea + Math.PI / 2;
  for (const sgn of [-1, 1]) {
    const ex = hx + Math.cos(ea) * off + Math.cos(perp) * sgn * r * 0.45;
    const ey = hy + Math.sin(ea) * off + Math.sin(perp) * sgn * r * 0.45;
    ctx.beginPath();
    ctx.arc(ex, ey, r * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = "#fff"; ctx.fill();
    ctx.beginPath();
    ctx.arc(ex + Math.cos(ea) * r * 0.12, ey + Math.sin(ea) * r * 0.12, r * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = "#111"; ctx.fill();
  }

  ctx.font = `600 ${Math.max(11, r * 0.9)}px Segoe UI`;
  ctx.fillStyle = s.id === myId ? "#fff" : "rgba(255,255,255,0.8)";
  ctx.textAlign = "center";
  ctx.fillText(s.n, hx, hy - r - 6);
}

function drawMinimap(snakes) {
  const size = 150, c = size / 2, scale = c / worldR;
  mctx.clearRect(0, 0, size, size);
  mctx.beginPath();
  mctx.arc(c, c, c - 2, 0, Math.PI * 2);
  mctx.fillStyle = "rgba(0,0,0,0.35)";
  mctx.fill();
  for (const b of beastStore) {
    mctx.beginPath();
    mctx.arc(c + b.x * scale, c + b.y * scale, 3, 0, Math.PI * 2);
    mctx.fillStyle = "#ff4d4d";
    mctx.fill();
  }
  for (const s of snakes) {
    mctx.beginPath();
    const px = c + s.b[0] * scale, py = c + s.b[1] * scale;
    mctx.arc(px, py, s.id === myId ? 3.5 : 2, 0, Math.PI * 2);
    mctx.fillStyle = s.id === myId ? "#fff" : s.c;
    mctx.fill();
  }
}

function updateHUD(snakes, me) {
  playersEl.textContent = lobbyInfo.playing || (me ? 1 : 0);
  if (!me) return;
  scoreEl.textContent = me.m;
  const sorted = snakes.slice().sort((a, b) => b.m - a.m);
  const rank = sorted.findIndex((s) => s.id === myId) + 1;
  rankEl.textContent = `${rank}/${snakes.length}`;
  if (rank > 0 && rank < bestRank) bestRank = rank;
}

// ----- Input -----
window.addEventListener("mousemove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
window.addEventListener("mousedown", () => (boosting = true));
window.addEventListener("mouseup", () => (boosting = false));
window.addEventListener("keydown", (e) => { if (e.code === "Space") boosting = true; });
window.addEventListener("keyup", (e) => { if (e.code === "Space") boosting = false; });
canvas.addEventListener("touchstart", (e) => {
  boosting = true;
  const t = e.touches[0]; mouse.x = t.clientX; mouse.y = t.clientY;
}, { passive: true });
canvas.addEventListener("touchmove", (e) => {
  const t = e.touches[0]; mouse.x = t.clientX; mouse.y = t.clientY;
}, { passive: true });
canvas.addEventListener("touchend", () => (boosting = false));

requestAnimationFrame(frame);
