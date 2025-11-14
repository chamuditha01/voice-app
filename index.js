// --- Prerequisites: ---
// 1. Install dependencies: npm install express socket.io
// 2. Run the server: node server.js

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// --- Configuration Constants ---
const ROOM_ID = 'voice_chat_room_1'; 
const PORT = 3000;

// --- Server Setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        // Allows connections from any client domain (including mobile and web clients)
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// --- Data Structures ---
// Map to store all active socket IDs for user listing
const activeUsers = new Map(); 
// Map to track which room each socket ID belongs to, for fast lookup on disconnect
const userToRoom = new Map(); 

/**
 * Broadcasts the current list of available users (socket IDs) to all connected clients.
 */
function broadcastUserList() {
    const userIds = Array.from(activeUsers.keys());
    console.log(`Broadcasting updated user list: ${userIds.length} total users.`);
    // Send the full list to everyone
    io.emit('users_update', userIds);
}

// --- Socket.IO Connection Handler ---
io.on('connection', (socket) => {
    console.log(`[${socket.id}] User connected.`);
    
    // 1. Add user to the active list and broadcast the update
    activeUsers.set(socket.id, socket.id);
    broadcastUserList();

    // --- Client joins a room (for logical grouping) ---
    socket.on('join_room', (roomID) => {
        socket.join(roomID);
        userToRoom.set(socket.id, roomID); // Track the room the user joined
        console.log(`[${socket.id}] joined room: ${roomID}.`);
        broadcastUserList(); 
    });

    // --- Signaling Step: Handle Offer (Initiates a peer-to-peer call) ---
    socket.on('offer', (data) => {
        // data = { offer: RTCSessionDescription, calleeID: string }
        console.log(`[${socket.id}] 📞 OFFER sent to [${data.calleeID}]`);
        
        // Relay the offer to the targeted peer (calleeID), including the caller's ID
        io.to(data.calleeID).emit('offer', {
            offer: data.offer,
            callerID: socket.id 
        });
    });

    // --- Signaling Step: Handle Answer (Responds to the offer) ---
    socket.on('answer', (data) => {
        // data = { answer: RTCSessionDescription, callerID: string }
        console.log(`[${socket.id}] 🤝 ANSWER sent back to [${data.callerID}]`);
        
        // Relay the answer to the original caller (callerID)
        io.to(data.callerID).emit('answer', {
            answer: data.answer,
            calleeID: socket.id // The answerer's ID
        });
    });

    // --- Signaling Step: Handle ICE Candidate (Network Negotiation) ---
    socket.on('ice_candidate', (data) => {
        // data = { candidate: RTCIceCandidate, targetID: string }
        // Relay candidate to the specified target
        io.to(data.targetID).emit('ice_candidate', {
            candidate: data.candidate,
            senderID: socket.id
        });
    });
    
    // --- Disconnection Handler ---
    socket.on('disconnect', async () => {
        const disconnectedID = socket.id;
        console.log(`[${disconnectedID}] User disconnected.`);
        
        // 1. Find the room the user was in
        const roomID = userToRoom.get(disconnectedID);
        
        if (roomID) {
            // Get all sockets currently in that room (excluding the one that just disconnected)
            const socketsInRoom = await io.in(roomID).fetchSockets();
            
            if (socketsInRoom.length > 0) {
                // If there is a remaining peer, notify them that their peer disconnected
                // We use socket.to(roomID) to send to everyone *in* the room, which should now only be the peer.
                // However, socket.to(socket.id) is the most reliable way to target.
                
                // Identify the remaining peer ID
                const remainingPeerSocket = socketsInRoom[0];
                const remainingPeerID = remainingPeerSocket.id;
                
                console.log(`[${disconnectedID}] disconnected from room ${roomID}. Notifying [${remainingPeerID}].`);
                
                // Notify the remaining peer
                io.to(remainingPeerID).emit('peer_disconnected');
            }
            // 2. Clean up room tracking
            userToRoom.delete(disconnectedID);
        }

        // 3. Remove from active users list and broadcast update
        activeUsers.delete(disconnectedID);
        broadcastUserList();
    });
});

// --- Server Start ---
server.listen(PORT, () => {
    console.log(`Signaling server running on port ${PORT}`);
    console.log(`Access at: http://localhost:${PORT}`);
});
