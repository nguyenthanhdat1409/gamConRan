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
const PUBLIC_ID = "public";
const rooms = new Map();

function getPublicRoom() {
  if (!rooms.has(PUBLIC_ID)) {
    rooms.set(PUBLIC_ID, new Room(PUBLIC_ID, { solo: false, botCount: 10 }));
  }
  return rooms.get(PUBLIC_ID);
}

// socket.data.roomId lưu phòng hiện tại của mỗi kết nối
io.on("connection", (socket) => {
  socket.on("join", ({ mode, name } = {}) => {
    leaveCurrent(socket);
    const cleanName = String(name || "Bạn").trim().slice(0, 12) || "Bạn";

    let room;
    if (mode === "solo") {
      const id = "solo-" + socket.id;
      room = new Room(id, { solo: true, botCount: 10 });
      rooms.set(id, room);
    } else {
      room = getPublicRoom();
    }

    room.addMember(socket.id, cleanName);
    socket.data.roomId = room.id;
    socket.join(room.id);

    socket.emit("joined", { room: room.id, mode: mode || "public" });
    broadcastLobby(room);
  });

  socket.on("spawn", () => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;
    const s = room.spawnPlayer(socket.id);
    if (s) socket.emit("spawned", { id: s.id });
    broadcastLobby(room);
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
  if (room.solo && room.isEmpty()) {
    rooms.delete(id); // dọn phòng solo trống
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
    // bỏ qua phòng solo hoàn toàn trống (giữ phòng public luôn chạy)
    if (room.solo && room.isEmpty()) continue;
    const dead = room.step();
    for (const d of dead) {
      io.to(d.socketId).emit("dead", { score: d.score });
    }
    io.to(room.id).emit("state", room.snapshot(withFood, withMeta));
  }
}, TICK_MS);

server.listen(PORT, () => {
  console.log(`Rắn săn mồi đang chạy tại http://localhost:${PORT}`);
});
