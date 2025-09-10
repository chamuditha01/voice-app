const http = require('http');
const WebSocket = require('ws');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

// rooms: Map<roomId, Array<WebSocket>>
const rooms = new Map();

wss.on('connection', (ws) => {
  ws.on('message', (msg) => {
    let data;
    try { data = JSON.parse(msg); } catch (err) { return; }
    const { type, room } = data;

    // handle join specially
    if (type === 'join') {
      ws.room = room;
      if (!rooms.has(room)) rooms.set(room, []);
      const clients = rooms.get(room);
      clients.push(ws);

      // tell the joining client how many clients are in the room
      ws.send(JSON.stringify({ type: 'joined', clients: clients.length }));

      // notify other(s) that a peer joined
      clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'peer-joined' }));
        }
      });

      return;
    }

    // For any other message type (offer/answer/ice/leave) forward to other peers in the room
    const roomClients = rooms.get(ws.room) || [];
    roomClients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  });

  ws.on('close', () => {
    const room = ws.room;
    if (!room) return;
    const clients = rooms.get(room) || [];
    const filtered = clients.filter((c) => c !== ws);
    if (filtered.length) rooms.set(room, filtered);
    else rooms.delete(room);

    // notify remaining peers
    filtered.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'peer-left' }));
      }
    });
  });
});

server.listen(3001, () => console.log('Signaling server listening on ws://localhost:3001'));