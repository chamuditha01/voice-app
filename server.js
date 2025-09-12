const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// Serve static frontend from /public
app.use(express.static(path.join(__dirname, "public")));


// Health check
app.get("/health", (req, res) => res.send("OK"));

// Socket.IO (binary-friendly)
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e6, // 1MB
});

const rooms = {};

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("join", (room) => {
    socket.join(room);
    rooms[socket.id] = room;
    console.log(`${socket.id} joined ${room}`);

    const count = io.sockets.adapter.rooms.get(room)?.size || 0;
    io.to(room).emit("clients", count);
  });

  socket.on("d", (payload) => {
    const room = rooms[socket.id];
    if (!room) return;

    socket.to(room).volatile.emit("d", {
      sid: socket.id,
      a: payload.buf,
      s: payload.sampleRate,
      b: payload.bitDepth,
      p: payload.p || 1,
    });
  });

  socket.on("leave", () => {
    const room = rooms[socket.id];
    if (room) {
      socket.leave(room);
      delete rooms[socket.id];
    }
  });

  socket.on("disconnect", () => {
    const room = rooms[socket.id];
    if (room) {
      const count = io.sockets.adapter.rooms.get(room)?.size || 0;
      io.to(room).emit("clients", count);
    }
    delete rooms[socket.id];
    console.log("Client disconnected:", socket.id);
  });
});

// ✅ IMPORTANT: bind to Railway's provided PORT and 0.0.0.0
const PORT = process.env.PORT || 8080;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[i] VoIP server running on port ${PORT}`);
});
