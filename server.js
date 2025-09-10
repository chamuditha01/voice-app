const express = require("express");
const http = require("http");
const cors = require("cors");
const mediasoup = require("mediasoup");
const socketIo = require("socket.io");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

let worker, router;
let transports = {}; // store send/recv transports per socket
let producers = {};  // store producers per socket

(async () => {
  worker = await mediasoup.createWorker();
  router = await worker.createRouter({
    mediaCodecs: [
      { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 }
    ]
  });
})();

// -------------------- HTTP Endpoints --------------------

// 1️⃣ Get RTP Capabilities
app.get("/rtpCapabilities", async (req, res) => {
  res.json(router.rtpCapabilities);
});

// 2️⃣ Create Send Transport
app.post("/createWebRtcTransport", async (req, res) => {
  const transport = await router.createWebRtcTransport({
    listenIps: ["0.0.0.0"],
    enableUdp: true,
    enableTcp: true
  });

  transports[req.body.socketId] = { sendTransport: transport };
  res.json({
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters
  });
});

// 3️⃣ Connect Transport
app.post("/connectTransport", async (req, res) => {
  const transport = transports[req.body.socketId].sendTransport;
  await transport.connect({ dtlsParameters: req.body.dtlsParameters });
  res.sendStatus(200);
});

// 4️⃣ Produce
app.post("/produce", async (req, res) => {
  const transport = transports[req.body.socketId].sendTransport;
  const producer = await transport.produce({ kind: req.body.kind, rtpParameters: req.body.rtpParameters });
  producers[req.body.socketId] = producer;

  // notify all other sockets about new producer
  socketIo.emit("new-producer", req.body.socketId);

  res.json({ id: producer.id });
});

// -------------------- Socket.IO --------------------
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

server.listen(3001, () => console.log("Server running on port 3001"));
