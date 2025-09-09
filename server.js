const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Map to store connected clients keyed by their user ID.
const clients = new Map();

wss.on('connection', ws => {
  console.log('New client connected.');

  ws.on('message', message => {
    const data = JSON.parse(message);

    switch (data.type) {
      case 'register':
        clients.set(data.userId, ws);
        console.log(`User ${data.userId} registered.`);
        break;

      case 'call_request':
        const speakerWs = clients.get(data.speakerId);
        if (speakerWs) {
          speakerWs.send(JSON.stringify({
            type: 'call_offer',
            offer: data.offer,
            learnerId: data.learnerId
          }));
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Speaker is not available or not found.'
          }));
        }
        break;

      case 'call_answer':
        const learnerWs = clients.get(data.learnerId);
        if (learnerWs) {
          learnerWs.send(JSON.stringify({
            type: 'call_answer',
            answer: data.answer,
            speakerId: data.speakerId
          }));
        }
        break;

      case 'ice_candidate':
        const recipientWs = clients.get(data.recipientId);
        if (recipientWs) {
          recipientWs.send(JSON.stringify({
            type: 'ice_candidate',
            candidate: data.candidate,
            senderId: data.senderId
          }));
        }
        break;

      default:
        console.log('Received unknown message type:', data.type);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected.');
    for (let [userId, clientWs] of clients.entries()) {
      if (clientWs === ws) {
        clients.delete(userId);
        console.log(`User ${userId} unregistered.`);
        break;
      }
    }
  });
});

server.listen(3001, () => {
  console.log('Signaling server listening on port 3001');
});