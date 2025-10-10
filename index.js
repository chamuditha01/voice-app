// --- Prerequisites: ---
// 1. Install dependencies: npm install express socket.io
// 2. Run the server: node server.js

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allows connections from any client domain (including your Expo Web app)
        methods: ["GET", "POST"]
    }
});

// Simple object to track users in rooms
const rooms = {};

io.on('connection', (socket) => {
    console.log(`[${socket.id}] User connected.`);

    // --- Signaling Step 1: Client joins a room ---
    socket.on('join_room', (roomID) => {
        socket.join(roomID);
        
        if (!rooms[roomID]) {
            rooms[roomID] = [];
        }

        // Add user to room if not already present
        if (!rooms[roomID].includes(socket.id)) {
            rooms[roomID].push(socket.id);
        }

        console.log(`[${socket.id}] joined room: ${roomID}. Participants: ${rooms[roomID].length}`);

        // --- Signaling Step 2: CORRECT Call Initiation Logic ---
        if (rooms[roomID].length === 2) {
            const callerID = rooms[roomID][0];
            const calleeID = rooms[roomID][1];

            // 1. Tell the CALLER (first user) to CREATE the OFFER.
            io.to(callerID).emit('start_call', calleeID); 
            
            // 2. Tell the CALLEE (second user) to PREPARE to receive the OFFER.
            // Note: The callee receives the callerID, not a new offer.
            io.to(calleeID).emit('incoming_call', callerID); 

            console.log(`Call initiated: [${callerID}] (Caller) vs [${calleeID}] (Callee)`);
        }
    });

    // --- Signaling Step 3: Handle Offer/Answer/ICE ---
    socket.on('offer', (data) => {
        // data = { offer: RTCSessionDescription, calleeID: string }
        console.log(`[${socket.id}] 📞 OFFER sent to [${data.calleeID}]`);
        io.to(data.calleeID).emit('offer', {
            offer: data.offer,
            callerID: socket.id 
        });
    });

    socket.on('answer', (data) => {
        // data = { answer: RTCSessionDescription, callerID: string }
        console.log(`[${socket.id}] 🤝 ANSWER sent back to [${data.callerID}]`);
        // The front-end answer handler expects the remote peer's ID to be the 'calleeID'
        io.to(data.callerID).emit('answer', {
            answer: data.answer,
            calleeID: socket.id // Using socket.id (the answerer's ID)
        });
    });

    socket.on('ice_candidate', (data) => {
        // data = { candidate: RTCIceCandidate, targetID: string }
        // Relay candidate to the specified target
        io.to(data.targetID).emit('ice_candidate', {
            candidate: data.candidate,
            senderID: socket.id
        });
        
        // 💬 LOGGING WHEN TRAFFIC IS LIKELY FLOWING
        // We log here every time a candidate is relayed, indicating active network negotiation.
        // This is the closest the server gets to knowing the "talking" status.
        console.log(`[${socket.id}] 🧊 ICE Candidate relayed to [${data.targetID}]`);
    });
    
    // --- Disconnection ---
    socket.on('disconnect', () => {
        const disconnectedID = socket.id;
        console.log(`[${disconnectedID}] User disconnected.`);
        
        // Remove user from all rooms and notify peers
        for (const roomID in rooms) {
            const index = rooms[roomID].indexOf(disconnectedID);
            
            if (index !== -1) {
                // If this user was the caller (index 0) or the callee (index 1)
                rooms[roomID].splice(index, 1);
                
                console.log(`[${disconnectedID}] removed from room ${roomID}.`);
                
                // Notify the remaining user that the call has ended
                socket.to(roomID).emit('peer_disconnected');
                
                if (rooms[roomID].length === 0) {
                    delete rooms[roomID];
                }
            }
        }
    });
});

const PORT = 3002;
server.listen(PORT, () => {
    console.log(`Signaling server running on port ${PORT}`);
    console.log(`Access at: http://localhost:${PORT}`);
});
