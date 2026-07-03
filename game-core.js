/* =========================================================
   Logic game rắn chạy trên SERVER (authoritative).
   Dùng chung cho phòng solo (1 người + bot) và phòng nhiều người.
   ========================================================= */

const WORLD_R = 2200;
const BASE_MASS = 12;
const MIN_MASS = 8;
const NORMAL_SPEED = 8.8; // px / tick (server ~20 tick/s)
const BOOST_SPEED = 16;
const MAX_TURN = 0.42; // rad / tick (rẽ nhạy hơn)
const FOOD_TARGET = 200;  // mức tối thiểu luôn giữ
const FOOD_MAX = 340;     // trần khi mọc thêm ngẫu nhiên
const BEAST_COUNT = 3; // số quái (khủng long) đi vòng vòng
const BEAST_SPEED = 3.2;

const COLORS = [
  "#4ade80", "#22d3ee", "#a78bfa", "#f472b6", "#fbbf24",
  "#fb7185", "#34d399", "#60a5fa", "#f59e0b", "#c084fc",
  "#2dd4bf", "#f87171", "#38bdf8", "#e879f9",
];

const BOT_NAMES = [
  "Bé Na", "Tí Anh", "Su Su", "Bin", "Cà Rốt", "Mì Gói", "Bơ", "Kem",
  "Gấu", "Xù", "Mập", "Cu Tí", "Bông", "Nhím", "Còi", "Mèo", "Ki Ki",
  "Đậu", "Bắp", "Tôm", "Cá Mập", "Rồng", "Hổ", "Sói", "Bọ", "Ong",
];
const GIANT_NAMES = ["Trùm Bự", "Mập Ú", "Bá Đạo", "Boss", "Khổng Lồ", "Đại Ca"];

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

function radiusOf(mass) {
  // ăn càng nhiều càng mập dần (tăng mạnh hơn + trần cao hơn)
  return 6 + Math.min(mass * 0.13, 34);
}
function neededCircles(mass) {
  return Math.round(10 + mass * 0.9);
}
function angleLerp(a, target, max) {
  let d = target - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (d > max) d = max;
  if (d < -max) d = -max;
  return a + d;
}

let SID = 1;
let BID = 1;

class Snake {
  constructor(isBot, name, color, startMass, fat) {
    const a = rand(0, Math.PI * 2);
    const r = rand(150, WORLD_R - 400);
    this.id = SID++;
    this.isBot = isBot;
    this.name = name || "Bạn";
    this.color = color || pick(COLORS);
    this.fat = fat || 1; // hệ số mập (bot khổng lồ > 1)
    this.x = Math.cos(a) * r;
    this.y = Math.sin(a) * r;
    this.angle = rand(0, Math.PI * 2);
    this.desired = this.angle;
    this.mass = startMass || BASE_MASS;
    this.boosting = false;
    this.alive = true;
    this.spawnProtect = 0; // số tick bất tử sau khi sinh
    this.speedMul = 1;     // hệ số tốc độ (khổng lồ < 1)
    this.preyRange = 520;  // tầm săn mồi (con khác)
    this.pts = [{ x: this.x, y: this.y }];
    this.body = [];
    this.radius = radiusOf(this.mass) * this.fat;
    this.seedTrail(); // tạo sẵn thân dài đúng kích thước ngay khi sinh
    this.buildBody(); // dựng body ngay để snapshot không lỗi ở tick đầu
    // AI
    this.roamAngle = this.angle;
    this.aiTimer = 0;
    this.aggro = Math.random() < 0.55;
  }

  // Đổ sẵn vệt phía sau đầu để rắn có độ dài đúng ngay khi xuất hiện
  seedTrail() {
    const r = radiusOf(this.mass) * this.fat;
    const gap = Math.max(3, r * 0.5);
    const need = neededCircles(this.mass) * gap + 30;
    const dx = -Math.cos(this.angle);
    const dy = -Math.sin(this.angle);
    const pts = [];
    for (let d = 0; d <= need; d += 4) {
      pts.push({ x: this.x + dx * d, y: this.y + dy * d });
    }
    this.pts = pts;
  }

  buildBody() {
    const r = radiusOf(this.mass) * this.fat;
    const gap = Math.max(3, r * 0.5);
    const count = neededCircles(this.mass);
    const body = [{ x: this.pts[0].x, y: this.pts[0].y }];
    let acc = 0;
    let lastIdx = 0;
    for (let i = 1; i < this.pts.length && body.length < count; i++) {
      const dx = this.pts[i].x - this.pts[i - 1].x;
      const dy = this.pts[i].y - this.pts[i - 1].y;
      acc += Math.sqrt(dx * dx + dy * dy);
      if (acc >= gap) {
        acc = 0;
        body.push({ x: this.pts[i].x, y: this.pts[i].y });
        lastIdx = i;
      }
    }
    if (this.pts.length > lastIdx + 6) this.pts.length = lastIdx + 6;
    this.body = body;
    this.radius = r;
  }
}

class Room {
  constructor(id, { solo = false, botCount = 14, beastCount = BEAST_COUNT, code = null } = {}) {
    this.id = id;
    this.solo = solo;
    this.code = code;      // mã phòng (null nếu solo)
    this.host = null;      // socketId của chủ phòng
    this.botCount = botCount;
    this.beastCount = beastCount;
    this.snakes = [];
    this.foods = [];
    this.beasts = [];
    // members: socketId -> { name, snakeId|null, hasSpawned }
    this.members = new Map();
    this.foodTick = 0;
    for (let i = 0; i < FOOD_TARGET; i++) this.spawnFood();
    this.ensureBots();
    for (let i = 0; i < beastCount; i++) this.spawnBeast();
  }

  // ---------- Quái (khủng long) ----------
  spawnBeast() {
    const a = rand(0, Math.PI * 2);
    const r = Math.sqrt(Math.random()) * (WORLD_R - 500);
    this.beasts.push({
      id: BID++,
      x: Math.cos(a) * r,
      y: Math.sin(a) * r,
      angle: rand(0, Math.PI * 2),
      r: rand(46, 66),
      speed: rand(BEAST_SPEED * 0.8, BEAST_SPEED * 1.3),
      turnTimer: 0,
      type: Math.floor(rand(0, 3)),
    });
  }
  updateBeasts(scale) {
    for (const bt of this.beasts) {
      bt.turnTimer--;
      // đổi hướng ngẫu nhiên
      if (bt.turnTimer <= 0) {
        bt.angle += rand(-0.8, 0.8);
        bt.turnTimer = Math.floor(rand(25, 70));
      }
      // né mép bản đồ
      if (Math.hypot(bt.x, bt.y) > WORLD_R - 260) {
        bt.angle = Math.atan2(-bt.y, -bt.x) + rand(-0.4, 0.4);
      }
      bt.x += Math.cos(bt.angle) * bt.speed * scale;
      bt.y += Math.sin(bt.angle) * bt.speed * scale;
    }
  }

  // ---------- Food ----------
  spawnFood(x, y, value, color) {
    if (x === undefined) {
      const a = rand(0, Math.PI * 2);
      const r = Math.sqrt(Math.random()) * (WORLD_R - 30);
      x = Math.cos(a) * r;
      y = Math.sin(a) * r;
    }
    this.foods.push({
      x, y,
      r: value ? Math.min(4 + value * 0.5, 9) : rand(3, 5),
      value: value || 1,
      c: color !== undefined ? color : Math.floor(rand(0, COLORS.length)),
    });
  }
  fillFood() {
    while (this.foods.length < FOOD_TARGET) this.spawnFood();
  }

  // ---------- Bot ----------
  // Tìm vị trí trống để sinh, tránh đè lên rắn/quái khác
  safeSpawn() {
    let best = { x: 0, y: 0 }, bestClear = -1;
    for (let i = 0; i < 25; i++) {
      const a = rand(0, Math.PI * 2);
      const r = Math.sqrt(Math.random()) * (WORLD_R - 300);
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      let clear = 1e9;
      for (const s of this.snakes) {
        if (!s.alive) continue;
        for (let j = 0; j < s.body.length; j += 3) {
          const b = s.body[j];
          const d = Math.hypot(x - b.x, y - b.y) - s.radius;
          if (d < clear) clear = d;
        }
      }
      for (const bt of this.beasts) {
        const d = Math.hypot(x - bt.x, y - bt.y) - bt.r;
        if (d < clear) clear = d;
      }
      if (clear > 280) return { x, y };
      if (clear > bestClear) { bestClear = clear; best = { x, y }; }
    }
    return best;
  }
  placeSafely(s) {
    const p = this.safeSpawn();
    s.x = p.x; s.y = p.y;
    s.seedTrail();
    s.buildBody();
  }

  addBot(giant) {
    let s;
    if (giant) {
      // bot mập (đã giảm còn ~70% độ dày trước đây) + CHẬM hơn để né được
      s = new Snake(true, "👑 " + pick(GIANT_NAMES), "#f59e0b", rand(80, 105), rand(1.7, 1.95));
      s.aggro = true;
      s.speedMul = 0.78;   // đi chậm hơn
      s.preyRange = 340;   // ít hung hăng, chỉ săn khi rất gần
    } else {
      // kích thước ngẫu nhiên: nhỏ tới vừa
      s = new Snake(true, pick(BOT_NAMES), pick(COLORS), rand(8, 42));
      s.speedMul = rand(0.92, 1.06); // mỗi con nhanh/chậm khác nhau chút -> sống động
    }
    this.placeSafely(s);
    s.spawnProtect = 15;
    this.snakes.push(s);
  }
  // Bổ sung cho đủ 2 khổng lồ + (botCount-2) thường. Chỉ gọi lúc tạo phòng / khi người chơi vào.
  ensureBots() {
    const aliveBots = this.snakes.filter((s) => s.isBot && s.alive);
    const giants = aliveBots.filter((s) => s.fat > 1.5).length;
    const normals = aliveBots.length - giants;
    for (let i = giants; i < 2; i++) this.addBot(true);
    for (let i = normals; i < this.botCount - 2; i++) this.addBot(false);
    this.snakes = this.snakes.filter((s) => s.alive);
  }

  // ---------- Người chơi ----------
  addMember(socketId, name) {
    this.members.set(socketId, { name: name || "Bạn", snakeId: null, hasSpawned: false });
    if (!this.host) this.host = socketId; // người vào đầu tiên làm chủ phòng
  }
  removeMember(socketId) {
    const m = this.members.get(socketId);
    if (m && m.snakeId != null) {
      const s = this.snakes.find((x) => x.id === m.snakeId && x.alive);
      if (s) s.alive = false; // biến mất, không rải mồi khi thoát
    }
    this.members.delete(socketId);
    // chuyển quyền chủ phòng nếu chủ rời đi
    if (this.host === socketId) {
      this.host = this.members.size ? this.members.keys().next().value : null;
    }
  }
  isHost(socketId) {
    return this.host === socketId;
  }
  spawnPlayer(socketId) {
    const m = this.members.get(socketId);
    if (!m) return null;
    // trận mới: nếu bot đã thưa (do trận trước bị diệt) thì bổ sung lại cho đủ
    this.ensureBots();
    const s = new Snake(false, m.name, pick(COLORS));
    this.placeSafely(s);
    s.spawnProtect = 100; // ~5s bất tử khi mới vào
    this.snakes.push(s);
    m.snakeId = s.id;
    m.hasSpawned = true;
    return s;
  }
  // Người chơi thật đang chờ hồi sinh (đã từng vào chơi nhưng đang chết)
  deadHumans() {
    const names = [];
    for (const m of this.members.values()) {
      if (m.hasSpawned && m.snakeId == null) names.push(m.name);
    }
    return names;
  }
  setInput(socketId, desired, boost) {
    const m = this.members.get(socketId);
    if (!m || m.snakeId == null) return;
    const s = this.snakes.find((x) => x.id === m.snakeId && x.alive);
    if (!s) return;
    if (typeof desired === "number" && isFinite(desired)) s.desired = desired;
    s.boosting = !!boost;
  }
  humanAlive() {
    let n = 0;
    for (const m of this.members.values()) {
      if (m.snakeId != null) {
        const s = this.snakes.find((x) => x.id === m.snakeId && x.alive);
        if (s) n++;
      }
    }
    return n;
  }
  lobbyInfo() {
    const players = [];
    for (const [sid, m] of this.members.entries()) {
      players.push({
        id: sid,
        name: m.name,
        host: sid === this.host,
        alive: m.snakeId != null,
      });
    }
    return {
      code: this.code,
      hostId: this.host,
      online: this.members.size,
      playing: this.humanAlive(),
      bots: this.snakes.filter((s) => s.isBot && s.alive).length,
      players,
    };
  }
  isEmpty() {
    return this.members.size === 0;
  }

  // ---------- AI ----------
  botThink(s) {
    s.aiTimer--;
    const dCenter = Math.hypot(s.x, s.y);
    if (dCenter > WORLD_R - 260) {
      s.desired = Math.atan2(-s.y, -s.x);
      return;
    }
    const headX = s.x + Math.cos(s.angle) * 60;
    const headY = s.y + Math.sin(s.angle) * 60;

    // Né quái (ưu tiên cao)
    for (const bt of this.beasts) {
      const safe = bt.r + s.radius + 120;
      if (dist2(s.x, s.y, bt.x, bt.y) < safe * safe) {
        s.desired = Math.atan2(s.y - bt.y, s.x - bt.x);
        return;
      }
    }

    for (const o of this.snakes) {
      if (o === s || !o.alive) continue;
      for (let i = 0; i < o.body.length; i += 2) {
        const b = o.body[i];
        if (dist2(headX, headY, b.x, b.y) < (o.radius + s.radius + 24) ** 2) {
          s.desired = Math.atan2(s.y - b.y, s.x - b.x);
          return;
        }
      }
    }

    // dao động nhẹ để đường đi cong mềm như người thật (không đi thẳng đơ)
    s.wander = (s.wander || 0) + 0.05;
    const sway = Math.sin(s.wander) * 0.1;

    if (s.aggro) {
      let prey = null, pd = (s.preyRange || 520) ** 2;
      for (const o of this.snakes) {
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

    // Tìm mồi gần nhất; có "quán tính" nhẹ: chỉ đổi mục tiêu khi mồi mới gần hơn hẳn
    let best = null, bd = 560 ** 2;
    for (const f of this.foods) {
      const d = dist2(s.x, s.y, f.x, f.y);
      if (d < bd) { bd = d; best = f; }
    }
    if (best) {
      s.desired = Math.atan2(best.y - s.y, best.x - s.x) + sway;
      return;
    }

    // Không có mồi gần -> lang thang: đổi hướng thưa nhưng vẫn di chuyển + lượn nhẹ
    if (s.aiTimer <= 0) {
      s.roamAngle += rand(-0.8, 0.8);
      s.aiTimer = Math.floor(rand(30, 70));
    }
    s.desired = s.roamAngle + sway * 2;
  }

  updateSnake(s, scale) {
    if (!s.alive) return;
    if (s.spawnProtect > 0) s.spawnProtect--;
    if (s.isBot) this.botThink(s);

    s.angle = angleLerp(s.angle, s.desired, MAX_TURN * scale);

    let sp = NORMAL_SPEED * (s.speedMul || 1);
    if (s.boosting && s.mass > MIN_MASS + 2) {
      sp = BOOST_SPEED * (s.speedMul || 1);
      s.mass -= 0.16 * scale;
      if (Math.random() < 0.4) {
        const tail = s.pts[s.pts.length - 1];
        this.spawnFood(tail.x + rand(-6, 6), tail.y + rand(-6, 6), 1,
          COLORS.indexOf(s.color) >= 0 ? COLORS.indexOf(s.color) : 0);
      }
    }
    s.x += Math.cos(s.angle) * sp * scale;
    s.y += Math.sin(s.angle) * sp * scale;
    s.pts.unshift({ x: s.x, y: s.y });
    s.buildBody();

    const rEat = s.radius + 14;
    for (let i = this.foods.length - 1; i >= 0; i--) {
      const f = this.foods[i];
      if (dist2(s.x, s.y, f.x, f.y) < rEat * rEat) {
        s.mass += f.value * 0.8;
        this.foods.splice(i, 1);
      }
    }
  }

  killSnake(s) {
    s.alive = false;
    const ci = COLORS.indexOf(s.color) >= 0 ? COLORS.indexOf(s.color) : 0;
    for (let i = 0; i < s.body.length; i += 2) {
      const b = s.body[i];
      this.spawnFood(b.x + rand(-6, 6), b.y + rand(-6, 6),
        Math.max(2, Math.round(s.radius * 0.4)), ci);
    }
  }

  // step trả về mảng socketId của người chơi vừa chết trong tick này
  step() {
    // Bù nhịp theo thời gian thực: nếu server chạy chậm hơn 50ms/tick,
    // rắn vẫn đi đúng tốc độ px/giây -> khớp với dự đoán ở client (hết giật ngược).
    const now = Date.now();
    if (!this.lastStep) this.lastStep = now - 50;
    let scale = (now - this.lastStep) / 50;
    this.lastStep = now;
    if (scale < 0.2) scale = 0.2;
    if (scale > 3) scale = 3;

    this.updateBeasts(scale);
    for (const s of this.snakes) this.updateSnake(s, scale);

    const deadPlayers = [];
    for (const s of this.snakes) {
      if (!s.alive) continue;
      if (s.spawnProtect > 0) continue; // bất tử lúc mới sinh
      if (Math.hypot(s.x, s.y) > WORLD_R) {
        this.killSnake(s);
        this.reportDeath(s, deadPlayers);
        continue;
      }
      // đụng quái -> chết luôn
      let eaten = false;
      for (const bt of this.beasts) {
        const rr = (s.radius + bt.r) ** 2;
        if (dist2(s.x, s.y, bt.x, bt.y) < rr) { eaten = true; break; }
      }
      if (eaten) {
        this.killSnake(s);
        this.reportDeath(s, deadPlayers);
        continue;
      }
      for (const o of this.snakes) {
        if (o === s || !o.alive) continue;
        const rr = (s.radius * 0.7 + o.radius) ** 2;
        // Bỏ qua ĐẦU + khúc cổ của đối thủ: chỉ chết khi đầu mình đâm vào
        // phần THÂN thật sự. Nếu đầu-chạm-đầu thì không ai chết ở đây,
        // còn kẻ nào lao đầu vào thân người khác thì mới bị hạ.
        const startI = Math.min(o.body.length - 1, 2);
        let hit = false;
        for (let i = startI; i < o.body.length; i++) {
          const b = o.body[i];
          if (dist2(s.x, s.y, b.x, b.y) < rr) { hit = true; break; }
        }
        if (hit) {
          this.killSnake(s);
          this.reportDeath(s, deadPlayers);
          break;
        }
      }
    }

    // dọn rắn chết (KHÔNG hồi sinh bot -> để có thể diệt hết mà thắng)
    this.snakes = this.snakes.filter((s) => s.alive);

    // trái cây: giữ mức tối thiểu + thỉnh thoảng mọc thêm ngẫu nhiên
    this.fillFood();
    this.foodTick++;
    if (this.foodTick % 40 === 0) {
      const n = 4 + Math.floor(Math.random() * 7);
      for (let i = 0; i < n && this.foods.length < FOOD_MAX; i++) this.spawnFood();
    }

    // Điều kiện THẮNG: chỉ còn 1 rắn sống và đó là người chơi
    const winners = [];
    const alive = this.snakes.filter((s) => s.alive);
    if (alive.length === 1 && !alive[0].isBot) {
      const w = alive[0];
      for (const [sid, m] of this.members.entries()) {
        if (m.snakeId === w.id) {
          m.snakeId = null;
          winners.push({ socketId: sid, score: Math.floor(w.mass) });
        }
      }
      w.alive = false;
      this.snakes = this.snakes.filter((s) => s.alive);
    }

    return { dead: deadPlayers, winners };
  }

  reportDeath(s, list) {
    if (s.isBot) return;
    for (const [sid, m] of this.members.entries()) {
      if (m.snakeId === s.id) {
        m.snakeId = null;
        list.push({ socketId: sid, score: Math.floor(s.mass) });
      }
    }
  }

  // ---------- Snapshot gửi cho client ----------
  snapshot(includeFood, includeMeta) {
    const snakes = [];
    for (const s of this.snakes) {
      if (!s.alive || !s.body || s.body.length === 0) continue;
      const pts = s.body;
      // gửi thưa "xương sống" (spacing theo bán kính) -> nhẹ băng thông
      const spacing = Math.max(14, s.radius * 1.3);
      const b = [Math.round(pts[0].x), Math.round(pts[0].y)];
      let lx = pts[0].x, ly = pts[0].y;
      for (let i = 1; i < pts.length; i++) {
        const d = Math.hypot(pts[i].x - lx, pts[i].y - ly);
        if (d >= spacing) {
          b.push(Math.round(pts[i].x), Math.round(pts[i].y));
          lx = pts[i].x; ly = pts[i].y;
        }
      }
      // đảm bảo có điểm đuôi
      const tail = pts[pts.length - 1];
      if (Math.hypot(tail.x - lx, tail.y - ly) > spacing * 0.5) {
        b.push(Math.round(tail.x), Math.round(tail.y));
      }
      snakes.push({
        id: s.id,
        n: s.name,
        c: s.color,
        r: Math.round(s.radius * 10) / 10,
        a: Math.round(s.angle * 100) / 100,
        m: Math.floor(s.mass),
        p: s.isBot ? 0 : 1,
        pr: s.spawnProtect > 0 ? 1 : 0,
        b,
      });
    }
    const beasts = this.beasts.map((b) => ({
      id: b.id,
      x: Math.round(b.x),
      y: Math.round(b.y),
      r: Math.round(b.r),
      a: Math.round(b.angle * 100) / 100,
      t: b.type,
    }));

    const snap = { w: WORLD_R, s: snakes, k: beasts };
    if (includeFood) {
      const f = new Array(this.foods.length * 4);
      for (let i = 0; i < this.foods.length; i++) {
        const fo = this.foods[i];
        f[i * 4] = Math.round(fo.x);
        f[i * 4 + 1] = Math.round(fo.y);
        f[i * 4 + 2] = Math.round(fo.r);
        f[i * 4 + 3] = fo.c;
      }
      snap.f = f;
    }
    if (includeMeta) {
      snap.d = this.deadHumans();
    }
    return snap;
  }
}

module.exports = { Room, COLORS, WORLD_R };
