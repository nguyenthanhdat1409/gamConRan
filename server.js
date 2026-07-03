const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const { Room } = require("./game-core");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------- Quản lý phòng ----------
const rooms = new Map(); // id -> Room

function cleanName(name) {
  return String(name || "Bạn").trim().slice(0, 12) || "Bạn";
}

function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // bỏ ký tự dễ nhầm
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function enterRoom(socket, room, name) {
  leaveCurrent(socket);
  room.addMember(socket.id, name);
  socket.data.roomId = room.id;
  socket.join(room.id);
  socket.emit("joined", {
    room: room.id,
    mode: room.solo ? "solo" : "room",
    code: room.code,
    host: room.isHost(socket.id),
  });
  broadcastLobby(room);
}

// socket.data.roomId lưu phòng hiện tại của mỗi kết nối
io.on("connection", (socket) => {
  // Chơi 1 mình: phòng riêng, vào chơi ngay
  socket.on("solo", ({ name } = {}) => {
    const id = "solo-" + socket.id;
    const room = new Room(id, { solo: true, botCount: 7 });
    rooms.set(id, room);
    enterRoom(socket, room, cleanName(name));
  });

  // Tạo phòng nhiều người -> có mã
  socket.on("createRoom", ({ name } = {}) => {
    const code = genCode();
    const room = new Room(code, { solo: false, botCount: 7, code });
    rooms.set(code, room);
    enterRoom(socket, room, cleanName(name));
  });

  // Vào phòng bằng mã
  socket.on("joinRoom", ({ name, code } = {}) => {
    const c = String(code || "").trim().toUpperCase();
    const room = rooms.get(c);
    if (!room || room.solo) {
      socket.emit("joinError", { msg: "Không tìm thấy phòng với mã này!" });
      return;
    }
    enterRoom(socket, room, cleanName(name));
  });

  socket.on("spawn", () => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;
    const s = room.spawnPlayer(socket.id);
    if (s) socket.emit("spawned", { id: s.id });
    broadcastLobby(room);
  });

  // Chủ phòng đá người khác
  socket.on("kick", ({ targetId } = {}) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || !room.isHost(socket.id) || targetId === socket.id) return;
    const target = io.sockets.sockets.get(targetId);
    if (target && target.data.roomId === room.id) {
      target.emit("kicked");
      leaveCurrent(target);
    }
  });

  socket.on("input", ({ a, boost } = {}) => {
    const room = rooms.get(socket.data.roomId);
    if (room) room.setInput(socket.id, a, boost);
  });

  socket.on("leave", () => leaveCurrent(socket));
  socket.on("disconnect", () => leaveCurrent(socket));
});

function leaveCurrent(socket) {
  const id = socket.data.roomId;
  if (!id) return;
  const room = rooms.get(id);
  socket.data.roomId = null;
  if (!room) return;
  socket.leave(id);
  room.removeMember(socket.id);
  if (room.isEmpty()) {
    rooms.delete(id); // dọn phòng trống (cả solo lẫn phòng mã)
  } else {
    broadcastLobby(room);
  }
}

function broadcastLobby(room) {
  io.to(room.id).emit("lobby", room.lobbyInfo());
}

// ---------- Vòng lặp game ----------
const TICK_MS = 50; // 20 tick/giây
let frame = 0;

setInterval(() => {
  frame++;
  const withFood = frame % 4 === 0; // gửi mồi 1/4 số tick cho nhẹ băng thông
  const withMeta = frame % 5 === 0; // danh sách người chơi đã chết cho bảng xếp hạng
  for (const room of rooms.values()) {
    if (room.isEmpty()) continue; // phòng trống sẽ được dọn khi rời
    try {
      const res = room.step();
      for (const d of res.dead) {
        io.to(d.socketId).emit("dead", { score: d.score });
      }
      for (const w of res.winners) {
        io.to(w.socketId).emit("win", { score: w.score });
      }
      io.to(room.id).emit("state", room.snapshot(withFood, withMeta));
    } catch (err) {
      // 1 tick lỗi không được phép làm sập cả server (gây đứng hình + giật)
      console.error("Lỗi tick phòng", room.id, err);
    }
  }
}, TICK_MS);

// Không để lỗi bất ngờ giết tiến trình -> tránh server restart giữa trận
process.on("uncaughtException", (err) => console.error("uncaughtException:", err));
process.on("unhandledRejection", (err) => console.error("unhandledRejection:", err));

server.listen(PORT, () => {
  console.log(`Rắn săn mồi đang chạy tại http://localhost:${PORT}`);
});
