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
const leaderboardEl = document.getElementById("leaderboard");
const lbListEl = document.getElementById("lbList");

// ----- State -----
let state = "menu"; // menu | lobby | playing | dead
let myId = null;
let worldR = 2200;
let bestRank = 999;
let currentMode = "solo";

const buffer = []; // {t, snap}
const INTERP_DELAY = 130; // ms (rắn khác)
let foodStore = []; // [x,y,r,ci,...]
let beastStore = []; // [{x,y,r,a,t}]
let deadHumans = []; // tên người chơi đã chết
let myName = "Bạn";
let roomCode = null;
let isHost = false;
let lobbyInfo = { online: 0, playing: 0, bots: 0, players: [] };
const BEAST_EMOJI = ["🦖", "🦕", "🐊"];

const cam = { x: 0, y: 0 };
let curZoom = 1;
const mouse = { x: 0, y: 0 };
let boosting = false;

// ----- Dự đoán phía client cho rắn của mình (phản hồi tức thì) -----
// Khớp với hằng số server (perTick * 20 tick/s)
const SPEED_PS = 8.8 * 20;   // px/giây
const BOOST_PS = 16 * 20;
const TURN_PS = 0.42 * 20;   // rad/giây
const MIN_MASS = 8;
let local = null;    // {x,y,angle,mass,radius,color,name,pts:[]}
let serverMe = null; // vị trí server mới nhất của rắn mình
let lastFrameT = performance.now();

function neededCircles(mass) { return Math.round(10 + mass * 0.9); }
function turnToward(a, target, max) {
  let d = target - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (d > max) d = max;
  if (d < -max) d = -max;
  return a + d;
}

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

socket.on("joined", ({ mode, code, host }) => {
  currentMode = mode;
  roomCode = code || null;
  isHost = !!host;
  if (mode === "solo") {
    socket.emit("spawn");
  } else {
    showLobby();
  }
});

socket.on("kicked", () => {
  goMenu();
  showConn("Bạn đã bị chủ phòng mời ra khỏi phòng.", 3000);
});

socket.on("joinError", ({ msg }) => {
  showConn(msg || "Không vào được phòng.", 2500);
});

socket.on("spawned", ({ id }) => {
  myId = id;
  bestRank = 999;
  local = null;
  serverMe = null;
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
  if (snap.d) deadHumans = snap.d;
  buffer.push({ t: performance.now(), snap });
  while (buffer.length > 12) buffer.shift();

  // hoà giải vị trí rắn của mình với server (nhẹ nhàng, tránh trôi)
  if (myId != null) {
    const sm = snap.s.find((s) => s.id === myId);
    if (sm) {
      serverMe = { x: sm.b[0], y: sm.b[1], a: sm.a, m: sm.m, r: sm.r, c: sm.c, n: sm.n, pr: sm.pr };
      if (local) {
        const ex = serverMe.x - local.x, ey = serverMe.y - local.y;
        const d = Math.hypot(ex, ey);
        if (d > 300) {
          local.x = serverMe.x; local.y = serverMe.y;
          local.pts = [{ x: local.x, y: local.y }];
        } else {
          local.x += ex * 0.06; local.y += ey * 0.06;
        }
      }
    }
  }
});

socket.on("dead", ({ score }) => {
  if (state !== "playing") return;
  endGame(score);
});

// ----- Flow -----
function getName() {
  myName = (document.getElementById("playerName").value || "Bạn").trim().slice(0, 12) || "Bạn";
  return myName;
}

document.getElementById("soloBtn").addEventListener("click", () => {
  socket.emit("solo", { name: getName() });
});
document.getElementById("createBtn").addEventListener("click", () => {
  socket.emit("createRoom", { name: getName() });
});
document.getElementById("joinBtn").addEventListener("click", joinByCode);
document.getElementById("roomCode").addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinByCode();
});
function joinByCode() {
  const code = (document.getElementById("roomCode").value || "").trim().toUpperCase();
  if (code.length < 3) { showConn("Nhập mã phòng (4 ký tự).", 2000); return; }
  socket.emit("joinRoom", { name: getName(), code });
}

document.getElementById("enterBtn").addEventListener("click", () => {
  socket.emit("spawn");
});
document.getElementById("backBtn").addEventListener("click", () => {
  socket.emit("leave");
  goMenu();
});
document.getElementById("copyCodeBtn").addEventListener("click", () => {
  if (!roomCode) return;
  navigator.clipboard?.writeText(roomCode);
  showConn("Đã sao chép mã: " + roomCode, 1500);
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
  if (e.key === "Enter") socket.emit("solo", { name: getName() });
});

let connTimer = null;
function showConn(msg, ms) {
  connEl.textContent = msg;
  connEl.classList.remove("hidden");
  if (connTimer) clearTimeout(connTimer);
  if (ms) connTimer = setTimeout(() => connEl.classList.add("hidden"), ms);
}

function goMenu() {
  state = "menu";
  myId = null;
  local = null;
  serverMe = null;
  roomCode = null;
  isHost = false;
  buffer.length = 0;
  hud.classList.add("hidden");
  mini.classList.add("hidden");
  leaderboardEl.classList.add("hidden");
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
  document.getElementById("roomCodeShow").textContent = roomCode || "----";
  document.getElementById("onlineCount").textContent = lobbyInfo.online;
  document.getElementById("botCount").textContent = lobbyInfo.bots;
  const list = document.getElementById("playerList");
  const players = lobbyInfo.players || [];
  let html = "";
  if (players.length === 0) {
    html = `<div class="empty">Chưa có ai... bạn là người đầu tiên!</div>`;
  } else {
    for (const p of players) {
      const badges =
        (p.host ? `<span class="badge">Chủ phòng</span>` : "") +
        (p.alive ? `<span class="badge" style="color:#4ade80;background:rgba(74,222,128,.15)">Đang chơi</span>` : "");
      const kickBtn = (isHost && !p.host)
        ? `<button class="kick" data-id="${p.id}">Đá</button>` : "";
      html += `<div class="row"><span class="dot"></span>` +
        `<span class="nm">${escapeHtml(p.name)}</span>${badges}${kickBtn}</div>`;
    }
  }
  list.innerHTML = html;
  list.querySelectorAll(".kick").forEach((btn) => {
    btn.addEventListener("click", () => socket.emit("kick", { targetId: btn.dataset.id }));
  });
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
  leaderboardEl.classList.remove("hidden");
}

function endGame(score) {
  state = "dead";
  document.getElementById("finalScore").textContent = score;
  document.getElementById("finalRank").textContent =
    bestRank === 999 ? "-" : "#" + bestRank;
  hud.classList.add("hidden");
  mini.classList.add("hidden");
  leaderboardEl.classList.add("hidden");
  gameover.classList.remove("hidden");
}

// ----- Bảng xếp hạng (cập nhật nhẹ, không mỗi frame) -----
setInterval(updateLeaderboard, 400);

function updateLeaderboard() {
  if (state !== "playing" || buffer.length === 0) return;
  const snakes = buffer[buffer.length - 1].snap.s.slice();
  snakes.sort((a, b) => b.m - a.m);

  const TOP = 8;
  let html = "";
  const myIdx = snakes.findIndex((s) => s.id === myId);

  const rowHtml = (rank, s) => {
    let cls = s.p === 1 ? "human" : "bot";
    if (s.id === myId) cls += " me";
    const icon = s.id === myId ? "★" : (s.p === 1 ? "👤" : "");
    return `<div class="lb-row ${cls}"><span class="lb-rank">${rank}</span>` +
      `<span class="lb-name">${icon ? icon + " " : ""}${escapeHtml(s.n)}</span>` +
      `<span class="lb-score">${s.m}</span></div>`;
  };

  const top = snakes.slice(0, TOP);
  top.forEach((s, i) => { html += rowHtml(i + 1, s); });

  // nếu mình ngoài top thì hiện thêm dòng của mình
  if (myIdx >= TOP) {
    html += `<div class="lb-sep">• • •</div>`;
    html += rowHtml(myIdx + 1, snakes[myIdx]);
  }

  // người chơi thật đã chết
  if (deadHumans && deadHumans.length) {
    html += `<div class="lb-sep">💀 Đã bị hạ gục</div>`;
    for (const n of deadHumans) {
      const cls = n === myName ? "dead me" : "dead";
      html += `<div class="lb-row ${cls}"><span class="lb-rank">–</span>` +
        `<span class="lb-name">👤 ${escapeHtml(n)}</span>` +
        `<span class="lb-score">chết</span></div>`;
    }
  }

  lbListEl.innerHTML = html;
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
      p: o.p,
      pr: o.pr,
      b,
    });
  }
  return out;
}
function cloneSnake(s) {
  return { id: s.id, n: s.n, c: s.c, r: s.r, a: s.a, m: s.m, p: s.p, pr: s.pr, b: s.b.slice() };
}
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ----- Dự đoán rắn của mình -----
function initLocal() {
  local = {
    x: serverMe.x, y: serverMe.y, angle: serverMe.a,
    mass: serverMe.m, radius: serverMe.r, color: serverMe.c, name: serverMe.n,
    pts: [],
  };
  const dx = -Math.cos(local.angle), dy = -Math.sin(local.angle);
  const gap = Math.max(3, local.radius * 0.5);
  const need = neededCircles(local.mass) * gap + 40;
  for (let d = 0; d <= need; d += 4) local.pts.push({ x: local.x + dx * d, y: local.y + dy * d });
}

function predict(dt) {
  if (state !== "playing" || !serverMe) return;
  if (!local) { initLocal(); return; }
  local.mass = serverMe.m;
  local.radius = serverMe.r;
  local.color = serverMe.c;
  local.name = serverMe.n;

  const desired = Math.atan2(mouse.y - canvas.height / 2, mouse.x - canvas.width / 2);
  local.angle = turnToward(local.angle, desired, TURN_PS * dt);
  const sp = (boosting && local.mass > MIN_MASS + 2) ? BOOST_PS : SPEED_PS;
  local.x += Math.cos(local.angle) * sp * dt;
  local.y += Math.sin(local.angle) * sp * dt;
  local.pts.unshift({ x: local.x, y: local.y });
}

function buildLocalBody() {
  const r = local.radius;
  const pts = local.pts;
  const circGap = Math.max(3, r * 0.5);
  const needDist = neededCircles(local.mass) * circGap + 40;
  let acc = 0, cut = pts.length;
  for (let i = 1; i < pts.length; i++) {
    acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc >= needDist) { cut = i + 1; break; }
  }
  if (pts.length > cut) pts.length = cut;

  const spacing = Math.max(14, r * 1.3);
  const b = [pts[0].x, pts[0].y];
  let lx = pts[0].x, ly = pts[0].y;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - lx, pts[i].y - ly);
    if (d >= spacing) { b.push(pts[i].x, pts[i].y); lx = pts[i].x; ly = pts[i].y; }
  }
  const tail = pts[pts.length - 1];
  if (Math.hypot(tail.x - lx, tail.y - ly) > spacing * 0.5) b.push(tail.x, tail.y);
  return b;
}

// ----- Render loop -----
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  let dt = (now - lastFrameT) / 1000;
  lastFrameT = now;
  if (dt > 0.05) dt = 0.05; // chống nhảy khi chuyển tab

  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (state !== "playing" && state !== "lobby" && state !== "dead") return;

  predict(dt);

  const others = interpolated() || [];
  // dựng rắn của mình từ dự đoán cục bộ
  let me = null;
  if (state === "playing" && local) {
    me = {
      id: myId, n: local.name, c: local.color, r: local.radius,
      a: local.angle, m: local.mass, p: 1,
      pr: serverMe && serverMe.pr ? 1 : 0, b: buildLocalBody(),
    };
  }

  const list = others.filter((s) => s.id !== myId);
  if (me) list.push(me);

  if (me) { cam.x = local.x; cam.y = local.y; }
  else if (state === "lobby") { cam.x = 0; cam.y = 0; }

  const zoom = zoomLevel(me ? me.r : 8);
  curZoom = zoom;

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

  const order = list.slice().sort((p, q) => p.m - q.m);
  for (const s of order) drawSnake(s);

  ctx.restore();

  drawMinimap(list);
  updateHUD(list, me);
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
  // vẽ mồi trong tầm nhìn thôi, không dùng shadowBlur -> mượt hơn nhiều
  const halfW = canvas.width / 2 / curZoom + 40;
  const halfH = canvas.height / 2 / curZoom + 40;
  for (let i = 0; i < foodStore.length; i += 4) {
    const x = foodStore[i], y = foodStore[i + 1];
    if (Math.abs(x - cam.x) > halfW || Math.abs(y - cam.y) > halfH) continue;
    ctx.beginPath();
    ctx.arc(x, y, foodStore[i + 2], 0, Math.PI * 2);
    ctx.fillStyle = COLORS[foodStore[i + 3]] || "#fff";
    ctx.fill();
  }
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
  const b = s.b;
  const n = b.length / 2;

  if (n >= 2) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(b[0], b[1]);
    for (let i = 1; i < n; i++) ctx.lineTo(b[i * 2], b[i * 2 + 1]);
    // viền tối
    ctx.strokeStyle = shade(s.c, -45);
    ctx.lineWidth = r * 2 + 4;
    ctx.stroke();
    // thân
    ctx.strokeStyle = s.c;
    ctx.lineWidth = r * 2;
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(b[0], b[1], r, 0, Math.PI * 2);
    ctx.fillStyle = s.c;
    ctx.fill();
  }

  const hx = b[0], hy = b[1];

  // khiên bất tử khi mới sinh
  if (s.pr) {
    const pulse = 1 + Math.sin(performance.now() / 150) * 0.12;
    ctx.beginPath();
    ctx.arc(hx, hy, r * 1.7 * pulse, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(120,220,255,0.7)";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(hx, hy, r * 1.08, 0, Math.PI * 2);
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

  drawName(s, hx, hy, r);
}

function drawName(s, hx, hy, r) {
  ctx.textAlign = "center";
  const isMe = s.id === myId;
  const isPlayer = s.p === 1;

  if (isPlayer) {
    // Người chơi thật: tên nổi bật + nền + biểu tượng, dễ tìm
    const label = (isMe ? "★ " : "👤 ") + s.n;
    const fs = Math.max(14, r * 1.05);
    ctx.font = `800 ${fs}px Segoe UI`;
    const w = ctx.measureText(label).width;
    const y = hy - r - 12;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    roundRect(hx - w / 2 - 8, y - fs, w + 16, fs + 8, 8);
    ctx.fill();
    ctx.fillStyle = isMe ? "#fff" : "#ffe27a";
    ctx.fillText(label, hx, y - fs * 0.18);
  } else {
    // Bot: tên mờ nhỏ cho đỡ rối
    ctx.font = `600 ${Math.max(10, r * 0.7)}px Segoe UI`;
    ctx.fillStyle = "rgba(255,255,255,0.38)";
    ctx.fillText(s.n, hx, hy - r - 6);
  }
}

function roundRect(x, y, w, h, rad) {
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
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
  // vẽ bot trước, người chơi thật sau (nổi lên trên)
  for (const s of snakes) {
    if (s.p === 1) continue;
    mctx.beginPath();
    mctx.arc(c + s.b[0] * scale, c + s.b[1] * scale, 1.8, 0, Math.PI * 2);
    mctx.fillStyle = s.c;
    mctx.fill();
  }
  for (const s of snakes) {
    if (s.p !== 1) continue;
    const px = c + s.b[0] * scale, py = c + s.b[1] * scale;
    const me = s.id === myId;
    mctx.beginPath();
    mctx.arc(px, py, me ? 4 : 3.5, 0, Math.PI * 2);
    mctx.fillStyle = me ? "#fff" : "#ffe27a";
    mctx.fill();
    mctx.lineWidth = 1.5;
    mctx.strokeStyle = "rgba(0,0,0,0.6)";
    mctx.stroke();
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
